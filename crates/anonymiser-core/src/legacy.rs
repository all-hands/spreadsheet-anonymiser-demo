use crate::token::hash_cell_unkeyed;
use crate::Error;
use sha2::Sha512;

pub const LEGACY_ENC_PREFIX: &str = "enc:";
pub const LEGACY_QENC_PREFIX: &str = "qenc:";

pub fn legacy_hmac_sha256(value: &str, key: &[u8]) -> String {
    use hmac::Hmac;
    use hmac::{KeyInit, Mac};
    use sha2::Sha256;

    let mut mac = <Hmac<Sha256>>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(value.as_bytes());
    let out = mac.finalize().into_bytes();
    hex::encode(&out[..8])
}

pub fn legacy_sha256(value: &str) -> String {
    let full = hash_cell_unkeyed(value);
    full.chars().take(16).collect()
}

pub fn legacy_mask(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    let len = chars.len();
    if len <= 2 {
        return "*".repeat(len);
    }
    let mut out = String::with_capacity(len);
    out.push(chars[0]);
    out.push_str(&"*".repeat(len - 2));
    out.push(chars[len - 1]);
    out
}

fn legacy_kdf(
    key: &[u8],
    salt: &[u8],
    quantum: bool,
) -> Result<aes_gcm::Key<aes_gcm::Aes256Gcm>, Error> {
    let mut out = [0u8; 32];
    if quantum {
        pbkdf2::pbkdf2_hmac::<Sha512>(key, salt, 500_000, &mut out);
    } else {
        pbkdf2::pbkdf2_hmac::<sha2::Sha256>(key, salt, 100_000, &mut out);
    }
    Ok(out.into())
}

fn legacy_encrypt_cell_with(
    value: &str,
    key: &[u8],
    salt: &[u8],
    nonce: &[u8; 12],
    quantum: bool,
) -> Result<String, Error> {
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    use aes_gcm::Aes256Gcm;
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;

    let cipher = Aes256Gcm::new(&legacy_kdf(key, salt, quantum)?);
    let ct = cipher
        .encrypt(nonce.into(), Payload::from(value.as_bytes()))
        .map_err(|_| Error::DecryptFailed)?;
    let mut out = Vec::with_capacity(salt.len() + 12 + ct.len());
    out.extend_from_slice(salt);
    out.extend_from_slice(nonce);
    out.extend_from_slice(&ct);
    let prefix = if quantum {
        LEGACY_QENC_PREFIX
    } else {
        LEGACY_ENC_PREFIX
    };
    Ok(format!("{}{}", prefix, B64.encode(out)))
}

pub fn legacy_encrypt_cell(value: &str, key: &[u8], quantum: bool) -> Result<String, Error> {
    let salt_len = if quantum { 32 } else { 16 };
    let mut material = vec![0u8; salt_len + 12];
    getrandom::fill(&mut material).expect("OS RNG");
    let (salt, nonce) = material.split_at(salt_len);
    let nonce: &[u8; 12] = nonce.try_into().expect("nonce is 12 bytes");
    legacy_encrypt_cell_with(value, key, salt, nonce, quantum)
}

pub fn legacy_decrypt_cell(value: &str, key: &[u8]) -> Result<String, Error> {
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    use aes_gcm::Aes256Gcm;
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;

    let (rest, quantum) = if let Some(rest) = value.strip_prefix(LEGACY_QENC_PREFIX) {
        (rest, true)
    } else if let Some(rest) = value.strip_prefix(LEGACY_ENC_PREFIX) {
        (rest, false)
    } else {
        return Err(Error::NotEncrypted);
    };
    let salt_len = if quantum { 32 } else { 16 };
    let combined = B64.decode(rest).map_err(|_| Error::NotEncrypted)?;
    if combined.len() < salt_len + 12 + 16 {
        return Err(Error::DecryptFailed);
    }
    let (salt, rest) = combined.split_at(salt_len);
    let (nonce, ct) = rest.split_at(12);
    let nonce: &[u8; 12] = nonce.try_into().expect("split_at(12) yields 12 bytes");

    let cipher = Aes256Gcm::new(&legacy_kdf(key, salt, quantum)?);
    let plain = cipher
        .decrypt(nonce.into(), Payload::from(ct))
        .map_err(|_| Error::DecryptFailed)?;
    String::from_utf8(plain).map_err(|_| Error::DecryptFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_decrypt_accepts_pinned_vectors() {
        let salt16 = [1u8; 16];
        let iv = [2u8; 12];
        let cell =
            legacy_encrypt_cell_with("member01", b"secret-key", &salt16, &iv, false).unwrap();
        assert_eq!(
            legacy_decrypt_cell(&cell, b"secret-key").unwrap(),
            "member01"
        );

        let salt32 = [3u8; 32];
        let qcell =
            legacy_encrypt_cell_with("member01", b"secret-key", &salt32, &iv, true).unwrap();
        assert!(qcell.starts_with("qenc:"));
        assert_eq!(
            legacy_decrypt_cell(&qcell, b"secret-key").unwrap(),
            "member01"
        );
    }
}
