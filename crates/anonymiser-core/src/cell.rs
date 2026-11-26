use crate::kyber::{kyber_decrypt_cell, KYBER_PREFIX};
use crate::legacy::{legacy_decrypt_cell, LEGACY_ENC_PREFIX, LEGACY_QENC_PREFIX};
use crate::Error;

pub const ENC_PREFIX: &str = "enc:v1:";

pub fn encrypt_cell(value: &str, col_key: &[u8], nonce: &[u8; 12]) -> Result<String, Error> {
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    use aes_gcm::Aes256Gcm;
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;

    if col_key.len() < 32 {
        return Err(Error::MissingKey);
    }
    let cipher = Aes256Gcm::new_from_slice(&col_key[..32]).map_err(|_| Error::MissingKey)?;
    let ct = cipher
        .encrypt(nonce.into(), Payload::from(value.as_bytes()))
        .map_err(|_| Error::DecryptFailed)?;
    let mut out = Vec::with_capacity(12 + ct.len());
    out.extend_from_slice(nonce);
    out.extend_from_slice(&ct);
    Ok(format!("{}{}", ENC_PREFIX, B64.encode(out)))
}

pub fn decrypt_cell(value: &str, col_key: &[u8]) -> Result<String, Error> {
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    use aes_gcm::Aes256Gcm;
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;

    let rest = value.strip_prefix(ENC_PREFIX).ok_or(Error::NotEncrypted)?;
    let combined = B64.decode(rest).map_err(|_| Error::NotEncrypted)?;
    if combined.len() < 12 + 16 || col_key.len() < 32 {
        return Err(Error::DecryptFailed);
    }
    let (nonce, ct) = combined.split_at(12);
    let nonce: &[u8; 12] = nonce.try_into().expect("split_at(12) yields 12 bytes");
    let cipher = Aes256Gcm::new_from_slice(&col_key[..32]).map_err(|_| Error::MissingKey)?;
    let plain = cipher
        .decrypt(nonce.into(), Payload::from(ct))
        .map_err(|_| Error::DecryptFailed)?;
    String::from_utf8(plain).map_err(|_| Error::DecryptFailed)
}

pub fn is_encrypted(value: &str) -> bool {
    value.starts_with(ENC_PREFIX)
        || value.starts_with(KYBER_PREFIX)
        || value.starts_with(LEGACY_ENC_PREFIX)
        || value.starts_with(LEGACY_QENC_PREFIX)
}

pub fn decrypt_any(
    value: &str,
    column_key: Option<&[u8]>,
    legacy_key: Option<&[u8]>,
) -> Result<String, Error> {
    if value.starts_with(KYBER_PREFIX) || value.starts_with(ENC_PREFIX) {
        let key = column_key.ok_or(Error::MissingDecryptKey)?;
        if value.starts_with(KYBER_PREFIX) {
            kyber_decrypt_cell(value, key)
        } else {
            decrypt_cell(value, key)
        }
    } else if value.starts_with(LEGACY_ENC_PREFIX) || value.starts_with(LEGACY_QENC_PREFIX) {
        let key = legacy_key.ok_or(Error::MissingDecryptKey)?;
        legacy_decrypt_cell(value, key)
    } else {
        Ok(value.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enc_cell() -> String {
        encrypt_cell("Jane Doe", &[5u8; 64], &[42u8; 12]).unwrap()
    }

    fn kyber_cell() -> String {
        crate::kyber_encrypt_cell("Jane Doe", &[5u8; 64]).unwrap()
    }

    fn legacy_cell(quantum: bool) -> String {
        crate::legacy_encrypt_cell("Jane Doe", b"old-key", quantum).unwrap()
    }

    #[test]
    fn decrypt_any_dispatches_each_prefix() {
        let col = &[5u8; 64];
        let legacy = b"old-key";

        assert_eq!(
            decrypt_any(&enc_cell(), Some(col), None).unwrap(),
            "Jane Doe"
        );
        assert_eq!(
            decrypt_any(&kyber_cell(), Some(col), None).unwrap(),
            "Jane Doe"
        );
        assert_eq!(
            decrypt_any(&legacy_cell(false), None, Some(legacy)).unwrap(),
            "Jane Doe"
        );
        assert_eq!(
            decrypt_any(&legacy_cell(true), None, Some(legacy)).unwrap(),
            "Jane Doe"
        );
    }

    #[test]
    fn decrypt_any_without_the_right_key_is_loud() {
        let col = &[5u8; 64];
        let legacy = b"old-key";

        assert!(matches!(
            decrypt_any(&enc_cell(), None, None),
            Err(Error::MissingDecryptKey)
        ));
        assert!(matches!(
            decrypt_any(&kyber_cell(), None, Some(legacy)),
            Err(Error::MissingDecryptKey)
        ));
        assert!(matches!(
            decrypt_any(&enc_cell(), Some(&[6u8; 64]), None),
            Err(Error::DecryptFailed)
        ));

        assert!(matches!(
            decrypt_any(&legacy_cell(false), None, None),
            Err(Error::MissingDecryptKey)
        ));
        assert!(matches!(
            decrypt_any(&legacy_cell(true), Some(col), None),
            Err(Error::MissingDecryptKey)
        ));
        assert!(matches!(
            decrypt_any(&legacy_cell(false), None, Some(b"wrong")),
            Err(Error::DecryptFailed)
        ));
    }

    #[test]
    fn decrypt_any_passes_foreign_values_through() {
        assert_eq!(decrypt_any("plain", None, None).unwrap(), "plain");
        assert_eq!(decrypt_any("", Some(&[5u8; 64]), None).unwrap(), "");
        assert!(matches!(
            decrypt_any("enc:v1:AAAA", None, Some(b"old-key")),
            Err(Error::MissingDecryptKey)
        ));
    }
}
