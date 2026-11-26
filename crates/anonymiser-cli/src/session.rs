use crate::salt_file::{Kdf, SaltOrigin};
use anonymiser_core::{
    derive_root_key, derive_root_key_raw, KeyMaterial, Policy, RootKey, KEY_FILE_LEN,
};
use anyhow::{anyhow, Context, Result};
use std::fs;
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

pub(crate) fn accept_master_key_bytes(
    path: &Path,
    bytes: &[u8],
    allow_legacy: bool,
) -> Result<Zeroizing<Vec<u8>>> {
    match anonymiser_core::parse_master_key(bytes) {
        Ok(file) => Ok(Zeroizing::new(file.key)),
        Err(e) => {
            let claims_envelope =
                bytes.len() == KEY_FILE_LEN || bytes.starts_with(&anonymiser_core::KEY_MAGIC);
            if allow_legacy && bytes.len() >= 32 && !claims_envelope {
                eprintln!(
                    "warning: {path:?} is a legacy raw key file; upgrade with \
                     `anonymiser keygen --upgrade-from {path:?}` (support is temporary)"
                );
                return Ok(Zeroizing::new(bytes.to_vec()));
            }
            if claims_envelope || matches!(e, anonymiser_core::Error::KeyChecksum) {
                Err(anyhow!("{path:?}: {e}"))
            } else {
                Err(anyhow!(
                    "{path:?} is not a master-key file ({e}); \
                     run `anonymiser keygen` or pass --allow-legacy-key \
                     for a pre-v1 raw key"
                ))
            }
        }
    }
}

pub(crate) fn load_or_create_master_key(
    path: &PathBuf,
    allow_legacy: bool,
) -> Result<Zeroizing<Vec<u8>>> {
    if path.exists() {
        let bytes = fs::read(path).with_context(|| format!("read master key {path:?}"))?;
        accept_master_key_bytes(path, &bytes, allow_legacy)
    } else {
        let mut key = vec![0u8; 64];
        getrandom::fill(&mut key).expect("OS RNG");
        let envelope = anonymiser_core::wrap_master_key(&key).expect("64-byte key wraps");
        crate::secret_file::write_new(path, &envelope)
            .with_context(|| format!("create master key {path:?}"))?;
        Ok(Zeroizing::new(key))
    }
}

/// SECURITY: `depseudo` reads the master key without ever creating one: an audit
/// command must not mint credentials as a side effect. Same acceptance
/// policy as `anonymise` (a corrupt envelope is not a legacy key).
pub(crate) fn read_master_key(path: &Path, allow_legacy: bool) -> Result<Zeroizing<Vec<u8>>> {
    let bytes = fs::read(path).with_context(|| format!("read master key {path:?}"))?;
    accept_master_key_bytes(path, &bytes, allow_legacy)
}

pub(crate) fn derive_column_key(
    root: &RootKey,
    file_salt: &[u8],
    dataset: Option<&str>,
    name: &str,
) -> Result<[u8; 64]> {
    let key = match dataset {
        Some(ds) => anonymiser_core::column_key_scoped(root, file_salt, ds, name),
        None => anonymiser_core::column_key(root, file_salt, name),
    }
    .with_context(|| format!("column {name:?}"))?;
    Ok(key)
}

pub(crate) struct Session {
    pub(crate) root: RootKey,
    pub(crate) master_key: Option<Zeroizing<Vec<u8>>>,
    pub(crate) file_salt: Zeroizing<Vec<u8>>,
    pub(crate) kdf: Kdf,
    pub(crate) salt_origin: SaltOrigin,
}

pub(crate) fn requested_kdf(args: &crate::args::AnonymiseArgs) -> Kdf {
    if args.passphrase.is_none() {
        return Kdf::HkdfRaw;
    }
    let base = match args.preset {
        Some(p) => anonymiser_core::Profile::from(p),
        None => anonymiser_core::Profile::browser(),
    };
    Kdf::Argon2id(anonymiser_core::Profile {
        iters: args.argon2_iters.unwrap_or(base.iters),
        memory_kb: args.argon2_memory_kb.unwrap_or(base.memory_kb),
        threads: args.argon2_threads.unwrap_or(base.threads),
    })
}

pub(crate) fn bootstrap(args: &crate::args::AnonymiseArgs) -> Result<Session> {
    let kdf = requested_kdf(args);
    let (salt, salt_origin) = if args.oneshot {
        (crate::salt_file::fresh_salt(), SaltOrigin::Oneshot)
    } else {
        crate::salt_file::load_or_create(&args.salt_file, kdf)?
    };
    let file_salt = Zeroizing::new(salt);
    let (root, master_key) = match (kdf, args.passphrase.as_deref()) {
        (Kdf::Argon2id(profile), Some(passphrase)) => {
            let pp = Zeroizing::new(passphrase.as_bytes().to_vec());
            (
                derive_root_key(&pp, &file_salt, profile)
                    .map_err(|e| anyhow!("passphrase key derivation: {e}"))?,
                None,
            )
        }
        _ => {
            let master_key =
                load_or_create_master_key(&args.master_key_file, args.allow_legacy_key)?;
            (
                derive_root_key_raw(&master_key, &file_salt),
                Some(master_key),
            )
        }
    };
    Ok(Session {
        root,
        master_key,
        file_salt,
        kdf,
        salt_origin,
    })
}

pub(crate) fn derive_column_keys(
    root: &RootKey,
    file_salt: &[u8],
    dataset: Option<&str>,
    decrypt: bool,
    policies: &[Policy],
    headers: &csv::StringRecord,
    file_groups: &[Option<String>],
) -> Result<Zeroizing<Vec<Option<[u8; 64]>>>> {
    let keys = headers
        .iter()
        .enumerate()
        .map(|(i, col)| {
            let needs_key = decrypt || matches!(policies[i].key_material(), KeyMaterial::ColumnKey);
            if !needs_key {
                return Ok(None);
            }
            let name = file_groups[i].as_deref().unwrap_or(col);
            Ok(Some(derive_column_key(root, file_salt, dataset, name)?))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Zeroizing::new(keys))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_envelope() -> Vec<u8> {
        let mut key = vec![0u8; 64];
        getrandom::fill(&mut key).expect("OS RNG");
        anonymiser_core::wrap_master_key(&key).expect("64-byte key wraps")
    }

    fn tmp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "anonymiser-cli-session-{}-{tag}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).expect("tmp dir");
        d
    }

    #[test]
    fn valid_envelope_is_accepted() {
        for allow_legacy in [false, true] {
            let env = valid_envelope();
            let k = accept_master_key_bytes(Path::new("k.bin"), &env, allow_legacy)
                .expect("valid envelope loads");
            let parsed = anonymiser_core::parse_master_key(&env).expect("round trip");
            assert_eq!(
                &*k,
                &parsed.key[..],
                "same key bytes, allow_legacy={allow_legacy}"
            );
        }
    }

    #[test]
    fn corrupt_envelope_is_rejected_even_with_allow_legacy() {
        let mut env = valid_envelope();
        assert_eq!(env.len(), KEY_FILE_LEN, "envelope length drift");
        let last = env.len() - 1;
        env[last] ^= 0xff;
        for allow_legacy in [false, true] {
            let err = accept_master_key_bytes(Path::new("k.bin"), &env, allow_legacy)
                .expect_err("corrupt envelope must fail closed");
            assert!(
                err.to_string().contains("checksum mismatch"),
                "allow_legacy={allow_legacy}: {err}"
            );
        }

        let mut foreign = valid_envelope();
        foreign[0] = b'X';
        let err = accept_master_key_bytes(Path::new("k.bin"), &foreign, true)
            .expect_err("right length, wrong magic is not legacy");
        assert!(
            err.to_string().contains("k.bin"),
            "error names the path: {err}"
        );
    }

    #[test]
    fn raw_key_requires_the_legacy_flag() {
        let raw64 = vec![7u8; 64];
        assert!(
            accept_master_key_bytes(Path::new("k.bin"), &raw64, false).is_err(),
            "raw key without the flag fails closed"
        );
        let k = accept_master_key_bytes(Path::new("k.bin"), &raw64, true)
            .expect("legacy raw key accepted under the flag");
        assert_eq!(&*k, &raw64[..]);

        let short = vec![7u8; 31];
        assert!(accept_master_key_bytes(Path::new("k.bin"), &short, true).is_err());
    }

    #[test]
    fn anonymise_mints_a_missing_key_depseudo_never_does() {
        let d = tmp_dir("mint");
        let p = d.join("master_key.bin");
        let k = load_or_create_master_key(&p, false).expect("create");
        assert_eq!(k.len(), 64);
        let again = load_or_create_master_key(&p, false).expect("reload the envelope");
        assert_eq!(&*k, &*again, "same file, same key");

        let missing = d.join("absent.bin");
        let err = read_master_key(&missing, false).expect_err("read never creates");
        assert!(err.to_string().contains("read master key"), "got: {err}");

        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn depseudo_read_rejects_corrupt_envelope_with_allow_legacy() {
        let d = tmp_dir("depseudo");
        let mut env = valid_envelope();
        let last = env.len() - 1;
        env[last] ^= 0xff;
        let p = d.join("corrupt.bin");
        fs::write(&p, &env).expect("write");
        let err = read_master_key(&p, true).expect_err("corrupt envelope is not a legacy key");
        assert!(err.to_string().contains("checksum mismatch"), "got: {err}");

        let _ = fs::remove_dir_all(&d);
    }
}
