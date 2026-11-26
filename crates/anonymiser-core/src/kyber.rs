use crate::Error;
use hkdf::Hkdf;
use sha2::Sha512;

pub const KYBER_PREFIX: &str = "kyber:v1:";

const KEM768_CT_LEN: usize = 1088;

fn kyber_keypair(col_key: &[u8]) -> Result<ml_kem::DecapsulationKey<ml_kem::MlKem768>, Error> {
    use ml_kem::{DecapsulationKey, MlKem768};

    if col_key.len() < 32 {
        return Err(Error::MissingKey);
    }
    let hk = Hkdf::<Sha512>::from_prk(col_key).map_err(|_| Error::HkdfExpand)?;
    let mut seed = [0u8; 64];
    hk.expand(b"anonymiser/mlkem768-seed", &mut seed)
        .map_err(|_| Error::HkdfExpand)?;
    Ok(DecapsulationKey::<MlKem768>::from_seed(seed.into()))
}

pub fn kyber_encrypt_cell(value: &str, col_key: &[u8]) -> Result<String, Error> {
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    use aes_gcm::Aes256Gcm;
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;

    if col_key.len() < 32 {
        return Err(Error::MissingKey);
    }
    let hk = Hkdf::<Sha512>::new(Some(col_key), value.as_bytes());
    let mut m = [0u8; 32];
    hk.expand(b"anonymiser/mlkem768-m", &mut m)
        .map_err(|_| Error::HkdfExpand)?;

    let dk = kyber_keypair(col_key)?;
    let (kem_ct, ss) = dk.encapsulation_key().encapsulate_deterministic(&m.into());

    let hk = Hkdf::<Sha512>::new(Some(col_key), &ss);
    let mut dem = [0u8; 32 + 12];
    hk.expand(b"anonymiser/mlkem768-dem", &mut dem)
        .map_err(|_| Error::HkdfExpand)?;
    let (key, nonce) = dem.split_at(32);
    let nonce: &[u8; 12] = nonce.try_into().expect("dem tail is 12 bytes");

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| Error::MissingKey)?;
    let ct = cipher
        .encrypt(nonce.into(), Payload::from(value.as_bytes()))
        .map_err(|_| Error::DecryptFailed)?;
    debug_assert_eq!(kem_ct.as_slice().len(), KEM768_CT_LEN);

    let mut out = Vec::with_capacity(KEM768_CT_LEN + ct.len());
    out.extend_from_slice(kem_ct.as_slice());
    out.extend_from_slice(&ct);
    Ok(format!("{}{}", KYBER_PREFIX, B64.encode(out)))
}

pub fn kyber_decrypt_cell(value: &str, col_key: &[u8]) -> Result<String, Error> {
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    use aes_gcm::Aes256Gcm;
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    use ml_kem::kem::Decapsulate;

    let rest = value
        .strip_prefix(KYBER_PREFIX)
        .ok_or(Error::NotEncrypted)?;
    let combined = B64.decode(rest).map_err(|_| Error::NotEncrypted)?;
    if combined.len() <= KEM768_CT_LEN + 16 || col_key.len() < 32 {
        return Err(Error::DecryptFailed);
    }
    let (kem_ct, ct) = combined.split_at(KEM768_CT_LEN);
    let kem_ct = ml_kem::Ciphertext::<ml_kem::MlKem768>::try_from(kem_ct)
        .map_err(|_| Error::DecryptFailed)?;

    let dk = kyber_keypair(col_key)?;
    let ss = dk.decapsulate(&kem_ct);

    let hk = Hkdf::<Sha512>::new(Some(col_key), &ss);
    let mut dem = [0u8; 32 + 12];
    hk.expand(b"anonymiser/mlkem768-dem", &mut dem)
        .map_err(|_| Error::HkdfExpand)?;
    let (key, nonce) = dem.split_at(32);
    let nonce: &[u8; 12] = nonce.try_into().expect("dem tail is 12 bytes");

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| Error::MissingKey)?;
    let plain = cipher
        .decrypt(nonce.into(), Payload::from(ct))
        .map_err(|_| Error::DecryptFailed)?;
    String::from_utf8(plain).map_err(|_| Error::DecryptFailed)
}
