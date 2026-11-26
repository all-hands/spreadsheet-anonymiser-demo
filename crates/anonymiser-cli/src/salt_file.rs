use anonymiser_core::{key_fingerprint, Profile, SALT_LEN};
use anyhow::{anyhow, bail, Context, Result};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

const MAGIC: &[u8; 8] = b"ANONSALT";
const VERSION: u8 = 1;
const KDF_HKDF: u8 = 1;
const KDF_ARGON2ID: u8 = 2;
const CHECK_LEN: usize = 4;
const FIXED_LEN: usize = 8 + 1 + SALT_LEN + 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kdf {
    HkdfRaw,
    Argon2id(Profile),
}

impl Kdf {
    pub(crate) fn id(&self) -> &'static str {
        match self {
            Kdf::HkdfRaw => "hkdf-sha512",
            Kdf::Argon2id(_) => "argon2id",
        }
    }
}

impl std::fmt::Display for Kdf {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Kdf::HkdfRaw => write!(f, "hkdf-sha512 (raw master key)"),
            Kdf::Argon2id(p) => write!(
                f,
                "argon2id (--argon2-iters {} --argon2-memory-kb {} --argon2-threads {})",
                p.iters, p.memory_kb, p.threads
            ),
        }
    }
}

#[derive(Debug)]
pub(crate) struct SaltFile {
    pub(crate) salt: Vec<u8>,
    pub(crate) kdf: Option<Kdf>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SaltOrigin {
    Oneshot,
    New,
    Versioned,
    LegacyRaw,
}

impl SaltOrigin {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            SaltOrigin::Oneshot => "oneshot",
            SaltOrigin::New | SaltOrigin::Versioned => "anonsalt-v1",
            SaltOrigin::LegacyRaw => "legacy-raw",
        }
    }
}

fn checksum(body: &[u8]) -> [u8; CHECK_LEN] {
    let mut out = [0u8; CHECK_LEN];
    out.copy_from_slice(&Sha256::digest(body)[..CHECK_LEN]);
    out
}

pub(crate) fn encode(salt: &[u8], kdf: Kdf) -> Vec<u8> {
    debug_assert_eq!(salt.len(), SALT_LEN);
    let mut b = Vec::with_capacity(FIXED_LEN + 12 + CHECK_LEN);
    b.extend_from_slice(MAGIC);
    b.push(VERSION);
    b.extend_from_slice(salt);
    match kdf {
        Kdf::HkdfRaw => b.push(KDF_HKDF),
        Kdf::Argon2id(p) => {
            b.push(KDF_ARGON2ID);
            for v in [p.iters, p.memory_kb, p.threads] {
                b.extend_from_slice(&v.to_le_bytes());
            }
        }
    }
    let c = checksum(&b);
    b.extend_from_slice(&c);
    b
}

pub(crate) fn decode(bytes: &[u8]) -> Result<SaltFile> {
    if !bytes.starts_with(MAGIC) {
        if bytes.len() != SALT_LEN {
            bail!("salt file must be exactly {SALT_LEN} bytes");
        }
        return Ok(SaltFile {
            salt: bytes.to_vec(),
            kdf: None,
        });
    }
    if bytes.len() < FIXED_LEN + CHECK_LEN {
        bail!("salt file is truncated");
    }
    if bytes[8] != VERSION {
        bail!(
            "salt file version {} is not supported by this tool (supports {VERSION})",
            bytes[8]
        );
    }
    let (body, tail) = bytes.split_at(bytes.len() - CHECK_LEN);
    if tail != checksum(body) {
        bail!("salt file checksum mismatch (corrupt)");
    }
    let params = &body[FIXED_LEN..];
    let u32_at = |i: usize| u32::from_le_bytes(params[i..i + 4].try_into().expect("4 bytes"));
    let kdf = match (body[FIXED_LEN - 1], params.len()) {
        (KDF_HKDF, 0) => Kdf::HkdfRaw,
        (KDF_ARGON2ID, 12) => Kdf::Argon2id(Profile {
            iters: u32_at(0),
            memory_kb: u32_at(4),
            threads: u32_at(8),
        }),
        (id, n) => bail!("salt file has an unknown KDF record (id {id}, {n} param bytes)"),
    };
    Ok(SaltFile {
        salt: body[9..9 + SALT_LEN].to_vec(),
        kdf: Some(kdf),
    })
}

pub(crate) fn read(path: &Path) -> Result<SaltFile> {
    let bytes = fs::read(path).with_context(|| format!("read salt {path:?}"))?;
    decode(&bytes)
}

pub(crate) fn read_salt_file(path: &Path) -> Result<Vec<u8>> {
    Ok(read(path)?.salt)
}

pub(crate) fn salt_id(salt: &[u8]) -> String {
    key_fingerprint(salt)
}

pub(crate) fn fresh_salt() -> Vec<u8> {
    let mut s = vec![0u8; SALT_LEN];
    getrandom::fill(&mut s).expect("OS RNG");
    s
}

pub(crate) fn load_or_create(path: &PathBuf, want: Kdf) -> Result<(Vec<u8>, SaltOrigin)> {
    if !path.exists() {
        let salt = fresh_salt();
        crate::secret_file::write_new(path, &encode(&salt, want))
            .with_context(|| format!("create salt file {path:?}"))?;
        return Ok((salt, SaltOrigin::New));
    }
    let file = read(path)?;
    match file.kdf {
        Some(recorded) if recorded != want => Err(anyhow!(
            "salt file {path:?} records {recorded}, but this run uses {want}. \
             A different KDF or cost gives different tokens for the same input \
             (joins would silently break). Re-run with the recorded settings, \
             or start a new --salt-file (all tokens will change)"
        )),
        Some(_) => Ok((file.salt, SaltOrigin::Versioned)),
        None => {
            if matches!(want, Kdf::Argon2id(_)) {
                eprintln!(
                    "warning: {path:?} is a legacy raw salt file with no recorded KDF \
                     parameters; this run uses {want}. Different --preset/--argon2-* \
                     values on a later run would silently change every token — the \
                     parameters are recorded in the run manifest. The salt file is \
                     left untouched."
                );
            }
            Ok((file.salt, SaltOrigin::LegacyRaw))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "anonymiser-cli-saltfile-{}-{tag}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).expect("tmp dir");
        d
    }

    const ARGON: Kdf = Kdf::Argon2id(Profile {
        iters: 2,
        memory_kb: 19456,
        threads: 1,
    });

    #[test]
    fn roundtrip_both_kdfs() {
        for kdf in [Kdf::HkdfRaw, ARGON] {
            let salt = fresh_salt();
            let back = decode(&encode(&salt, kdf)).expect("decode");
            assert_eq!(back.salt, salt);
            assert_eq!(back.kdf, Some(kdf));
        }
    }

    #[test]
    fn legacy_raw_is_exactly_32_bytes() {
        let f = decode(&[7u8; 32]).expect("legacy");
        assert_eq!(f.salt, [7u8; 32]);
        assert!(f.kdf.is_none());
        for n in [0, 31, 33, 45] {
            let err = decode(&vec![7u8; n]).expect_err("wrong length fails");
            assert_eq!(err.to_string(), "salt file must be exactly 32 bytes");
        }
    }

    #[test]
    fn damaged_versioned_files_fail_closed() {
        let msg = |b: &[u8]| decode(b).expect_err("must fail").to_string();
        let good = encode(&fresh_salt(), ARGON);
        let mut flipped = good.clone();
        flipped[20] ^= 1;
        assert!(msg(&flipped).contains("checksum"));
        assert!(msg(&good[..good.len() - 1]).contains("checksum"));
        assert!(msg(&good[..20]).contains("truncated"));
        let mut future = good.clone();
        future[8] = 2;
        assert!(msg(&future).contains("version 2"));
        let mut extra = good.clone();
        extra.insert(good.len() - CHECK_LEN, 0);
        let end = extra.len() - CHECK_LEN;
        let c = checksum(&extra[..end]);
        extra[end..].copy_from_slice(&c);
        assert!(msg(&extra).contains("unknown KDF record"));
    }

    #[test]
    fn create_reload_and_mismatch() {
        let d = tmp_dir("lc");
        let p = d.join("s.salt");
        let (s1, o1) = load_or_create(&p, ARGON).expect("create");
        assert_eq!(o1, SaltOrigin::New);
        let (s2, o2) = load_or_create(&p, ARGON).expect("reload");
        assert_eq!((s1.clone(), o2), (s2, SaltOrigin::Versioned));

        let other = Kdf::Argon2id(Profile {
            iters: 3,
            ..match ARGON {
                Kdf::Argon2id(p) => p,
                _ => unreachable!(),
            }
        });
        for want in [other, Kdf::HkdfRaw] {
            let err = load_or_create(&p, want).expect_err("mismatch");
            assert!(err.to_string().contains("records argon2id"), "{err}");
        }
        assert_eq!(read(&p).expect("untouched").salt, s1);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn legacy_salt_is_read_and_left_untouched() {
        let d = tmp_dir("legacy");
        let p = d.join("old.salt");
        fs::write(&p, [9u8; 32]).expect("write");
        for want in [ARGON, Kdf::HkdfRaw] {
            let (s, o) = load_or_create(&p, want).expect("legacy ok");
            assert_eq!((s, o), (vec![9u8; 32], SaltOrigin::LegacyRaw));
        }
        assert_eq!(fs::read(&p).expect("read"), vec![9u8; 32]);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn audit_reader_enforces_the_length_rule() {
        let d = tmp_dir("audit");
        let short = d.join("short.salt");
        fs::write(&short, [0u8; 31]).expect("write");
        let err = read_salt_file(&short).expect_err("fails");
        assert_eq!(err.to_string(), "salt file must be exactly 32 bytes");
        let _ = fs::remove_dir_all(&d);
    }
}
