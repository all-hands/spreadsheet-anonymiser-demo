use crate::keys::RootKey;
use crate::Error;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::XChaCha20Poly1305;
use hkdf::Hkdf;
use sha2::Sha512;

pub const MAPPING_NONCE_LEN: usize = 24;
pub const MAPPING_KEY_LEN: usize = 32;

pub fn mapping_key(root: &RootKey, dataset: &str) -> [u8; MAPPING_KEY_LEN] {
    let hk = Hkdf::<Sha512>::new(None, root.as_bytes());
    let mut okm = [0u8; MAPPING_KEY_LEN];
    hk.expand_multi_info(&[b"anonymiser/mapping/v1\0", dataset.as_bytes()], &mut okm)
        .expect("hkdf expand within limits");
    okm
}

fn mapping_aad(dataset: &str, group: &str, token: &str) -> Vec<u8> {
    let mut aad = Vec::with_capacity(32 + dataset.len() + group.len() + token.len());
    aad.extend_from_slice(b"anonymiser/mapping/aad/v1\0");
    aad.extend_from_slice(dataset.as_bytes());
    aad.push(0);
    aad.extend_from_slice(group.as_bytes());
    aad.push(0);
    aad.extend_from_slice(token.as_bytes());
    aad
}

pub fn seal_mapping_value(
    key: &[u8; MAPPING_KEY_LEN],
    dataset: &str,
    group: &str,
    token: &str,
    canonical: &str,
) -> Result<([u8; MAPPING_NONCE_LEN], Vec<u8>), Error> {
    let mut nonce = [0u8; MAPPING_NONCE_LEN];
    getrandom::fill(&mut nonce).expect("OS RNG");
    let cipher = XChaCha20Poly1305::new(key.into());
    let ct = cipher
        .encrypt(
            (&nonce).into(),
            Payload {
                msg: canonical.as_bytes(),
                aad: &mapping_aad(dataset, group, token),
            },
        )
        .map_err(|_| Error::DecryptFailed)?;
    Ok((nonce, ct))
}

pub fn open_mapping_value(
    key: &[u8; MAPPING_KEY_LEN],
    dataset: &str,
    group: &str,
    token: &str,
    nonce: &[u8; MAPPING_NONCE_LEN],
    ciphertext: &[u8],
) -> Result<String, Error> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let pt = cipher
        .decrypt(
            nonce.into(),
            Payload {
                msg: ciphertext,
                aad: &mapping_aad(dataset, group, token),
            },
        )
        .map_err(|_| Error::DecryptFailed)?;
    String::from_utf8(pt).map_err(|_| Error::DecryptFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::derive_root_key_raw;

    fn key(dataset: &str) -> [u8; MAPPING_KEY_LEN] {
        mapping_key(&derive_root_key_raw(&[9u8; 64], &[1u8; 32]), dataset)
    }

    #[test]
    fn roundtrip_and_aad_binding() {
        let k = key("customers-2026");
        let (nonce, ct) =
            seal_mapping_value(&k, "customers-2026", "email", "deadbeef", "a@b.com").unwrap();
        assert_eq!(
            open_mapping_value(&k, "customers-2026", "email", "deadbeef", &nonce, &ct).unwrap(),
            "a@b.com"
        );
        for (ds, g, t) in [
            ("other", "email", "deadbeef"),
            ("customers-2026", "phone", "deadbeef"),
            ("customers-2026", "email", "cafef00d"),
        ] {
            assert!(open_mapping_value(&k, ds, g, t, &nonce, &ct).is_err());
        }
        assert_ne!(key("other"), k);
    }

    #[test]
    fn mapping_key_is_distinct_from_column_keys() {
        let root = derive_root_key_raw(&[9u8; 64], &[1u8; 32]);
        let mk = mapping_key(&root, "ds");
        let ck = crate::column_key_scoped(&root, &[1u8; 32], "ds", "email").unwrap();
        assert!(!ck.windows(MAPPING_KEY_LEN).any(|w| w == mk));
    }

    #[test]
    fn nonces_are_unique() {
        let k = key("ds");
        let (n1, _) = seal_mapping_value(&k, "ds", "g", "t", "v").unwrap();
        let (n2, _) = seal_mapping_value(&k, "ds", "g", "t", "v").unwrap();
        assert_ne!(n1, n2);
    }
}
