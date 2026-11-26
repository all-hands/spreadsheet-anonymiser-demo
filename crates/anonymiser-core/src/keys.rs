use crate::Error;
use argon2::{Algorithm, Argon2, Params, Version};
use blake2::{Blake2b512, Digest};
use hkdf::Hkdf;
use sha2::Sha512;
use zeroize::Zeroize;

pub const SALT_LEN: usize = 32;
pub const MASTER_KEY_LEN: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Profile {
    pub iters: u32,
    pub memory_kb: u32,
    pub threads: u32,
}

impl Profile {
    pub fn cli() -> Self {
        Self {
            iters: 3,
            memory_kb: 65536,
            threads: 1,
        }
    }

    pub fn browser() -> Self {
        Self {
            iters: 2,
            memory_kb: 19456,
            threads: 1,
        }
    }
}

pub struct RootKey([u8; 64]);

impl RootKey {
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

impl Drop for RootKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl fmt::Debug for RootKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "RootKey(..)")
    }
}

use std::fmt;

pub fn derive_root_key(
    master_key: &[u8],
    file_salt: &[u8],
    profile: Profile,
) -> Result<RootKey, Error> {
    let params = Params::new(profile.memory_kb, profile.iters, profile.threads, Some(64))
        .map_err(|_| Error::Argon2Params)?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; 64];
    argon
        .hash_password_into(master_key, file_salt, &mut out)
        .map_err(|_| Error::Argon2Derive)?;
    Ok(RootKey(out))
}

pub fn derive_root_key_raw(master_key: &[u8], file_salt: &[u8]) -> RootKey {
    let hk = Hkdf::<Sha512>::new(Some(file_salt), master_key);
    let mut okm = [0u8; 64];
    hk.expand(b"anonymiser/raw-root/v1", &mut okm)
        .expect("hkdf expand within limits");
    RootKey(okm)
}

/// INVARIANT: The NUL rule is owned here, not by the callers: the name *is* the
/// HKDF info, and [`column_key_scoped`] glues `dataset ‖ \0 ‖ column` — a NUL
/// inside a name would let two different pairs concatenate to the same info
/// bytes and silently share a key. NUL-bearing names are a hard error
/// ([`Error::NulInKeyName`]).
pub fn column_key(root: &RootKey, file_salt: &[u8], column_name: &str) -> Result<[u8; 64], Error> {
    if column_name.contains('\0') {
        return Err(Error::NulInKeyName);
    }
    let hk = Hkdf::<Sha512>::new(Some(file_salt), root.as_bytes());
    let mut okm = [0u8; 64];
    hk.expand(column_name.as_bytes(), &mut okm)
        .map_err(|_| Error::HkdfExpand)?;
    Ok(okm)
}

pub fn column_key_scoped(
    root: &RootKey,
    file_salt: &[u8],
    dataset: &str,
    column_name: &str,
) -> Result<[u8; 64], Error> {
    if dataset.contains('\0') || column_name.contains('\0') {
        return Err(Error::NulInKeyName);
    }
    if dataset.is_empty() {
        return Err(Error::EmptyDataset);
    }
    let hk = Hkdf::<Sha512>::new(Some(file_salt), root.as_bytes());
    let mut okm = [0u8; 64];
    hk.expand_multi_info(
        &[
            b"anonymiser/v2\0",
            dataset.as_bytes(),
            b"\0",
            column_name.as_bytes(),
        ],
        &mut okm,
    )
    .map_err(|_| Error::HkdfExpand)?;
    Ok(okm)
}

pub fn key_fingerprint(key: &[u8]) -> String {
    let mut h = Blake2b512::new();
    h.update(key);
    hex::encode(&h.finalize()[..8])
}

pub const KEY_MAGIC: [u8; 8] = *b"CSVANON\x01";
pub const KEY_VERSION: u16 = 1;
pub const KEY_FILE_LEN: usize = 114;

#[derive(Debug, Clone)]
pub struct MasterKeyFile {
    pub key: Vec<u8>,
    pub key_id: String,
}

pub fn wrap_master_key(key: &[u8]) -> Result<Vec<u8>, Error> {
    if key.len() < 32 || key.len() > MASTER_KEY_LEN {
        return Err(Error::KeyLen(key.len()));
    }
    if key.len() != MASTER_KEY_LEN {
        return Err(Error::KeyNotEnvelopable(key.len()));
    }
    let mut out = Vec::with_capacity(KEY_FILE_LEN);
    out.extend_from_slice(&KEY_MAGIC);
    out.extend_from_slice(&KEY_VERSION.to_le_bytes());
    out.extend_from_slice(&key_id_bytes(key));
    out.extend_from_slice(key);
    let mut h = Blake2b512::new();
    h.update(&out);
    let digest = h.finalize();
    out.extend_from_slice(&digest[..32]);
    Ok(out)
}

pub fn parse_master_key(bytes: &[u8]) -> Result<MasterKeyFile, Error> {
    if bytes.len() != KEY_FILE_LEN {
        return Err(Error::KeyLen(bytes.len()));
    }
    if bytes[..8] != KEY_MAGIC {
        return Err(Error::NotAKeyFile);
    }
    let version = u16::from_le_bytes([bytes[8], bytes[9]]);
    if version != KEY_VERSION {
        return Err(Error::KeyVersion(version));
    }
    let mut h = Blake2b512::new();
    h.update(&bytes[..82]);
    if h.finalize()[..32] != bytes[82..] {
        return Err(Error::KeyChecksum);
    }
    let key = bytes[18..82].to_vec();
    if key_id_bytes(&key) != bytes[10..18] {
        return Err(Error::KeyChecksum);
    }
    Ok(MasterKeyFile {
        key_id: hex::encode(&bytes[10..18]),
        key,
    })
}

fn key_id_bytes(key: &[u8]) -> [u8; 8] {
    let mut h = Blake2b512::new();
    h.update(key);
    let digest = h.finalize();
    let mut id = [0u8; 8];
    id.copy_from_slice(&digest[..8]);
    id
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_roundtrip_and_rejects_garbage() {
        let key = [7u8; 64];
        let env = wrap_master_key(&key).unwrap();
        assert_eq!(env.len(), KEY_FILE_LEN);
        let parsed = parse_master_key(&env).unwrap();
        assert_eq!(parsed.key, key);
        assert_eq!(parsed.key_id, key_fingerprint(&key));

        assert!(matches!(
            parse_master_key(&[0u8; 64]),
            Err(Error::KeyLen(64))
        ));
        assert!(matches!(
            parse_master_key(&{
                let mut v = env.clone();
                v[0] ^= 1;
                v
            }),
            Err(Error::NotAKeyFile)
        ));
        assert!(matches!(
            parse_master_key(&{
                let mut v = env.clone();
                v[50] ^= 1;
                v
            }),
            Err(Error::KeyChecksum)
        ));
        assert!(matches!(
            wrap_master_key(&[0u8; 31]),
            Err(Error::KeyLen(31))
        ));
        assert!(matches!(
            wrap_master_key(&[0u8; 65]),
            Err(Error::KeyLen(65))
        ));
        assert!(matches!(
            wrap_master_key(&[0u8; 32]),
            Err(Error::KeyNotEnvelopable(32))
        ));
        assert!(matches!(
            wrap_master_key(&[0u8; 63]),
            Err(Error::KeyNotEnvelopable(63))
        ));
    }

    #[test]
    fn empty_dataset_namespace_is_rejected() {
        let root = derive_root_key_raw(&[1u8; 64], b"salt");
        assert!(matches!(
            column_key_scoped(&root, b"salt", "", "col"),
            Err(Error::EmptyDataset)
        ));
        assert!(column_key_scoped(&root, b"salt", "d", "col").is_ok());
    }

    #[test]
    fn nul_key_names_are_rejected_not_aliased() {
        let root = derive_root_key_raw(&[3u8; 64], &[1u8; 32]);
        let salt = [2u8; SALT_LEN];

        for (dataset, column) in [("x\0y", "z"), ("x", "y\0z")] {
            assert!(
                matches!(
                    column_key_scoped(&root, &salt, dataset, column),
                    Err(Error::NulInKeyName)
                ),
                "({dataset:?}, {column:?}) must be rejected"
            );
        }
        assert!(matches!(
            column_key(&root, &salt, "a\0b"),
            Err(Error::NulInKeyName)
        ));

        let a = column_key_scoped(&root, &salt, "x", "z").unwrap();
        let b = column_key_scoped(&root, &salt, "x", "z").unwrap();
        let v1 = column_key(&root, &salt, "z").unwrap();
        assert_eq!(a, b);
        assert_ne!(a, v1);
    }
}
