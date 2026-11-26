use anonymiser_core::{
    apply_typed, derive_root_key, reencode_token, CanonType, Date, Error, Policy, Profile, RootKey,
    TokenEncoding, DEFAULT_TOKEN_BYTES, SALT_LEN,
};
use getrandom::SysRng;
use rand_core::{Rng, UnwrapErr};
use std::str::FromStr;
use wasm_bindgen::prelude::*;
use zeroize::Zeroizing;

fn profile_for(preset: &str) -> Result<Profile, JsError> {
    match preset {
        "cli" => Ok(Profile::cli()),
        "browser" => Ok(Profile::browser()),
        other => Err(JsError::new(&format!(
            "unknown preset {other:?}: expected \"cli\" or \"browser\""
        ))),
    }
}

fn map_err(e: Error) -> JsError {
    JsError::new(&e.to_string())
}

const COLUMN_KEY_LEN: usize = 64;

const MAX_TOKEN_HEX_LEN: usize = 128;

fn check_column_key(key: &[u8]) -> Result<(), String> {
    if key.len() == COLUMN_KEY_LEN {
        Ok(())
    } else {
        Err(format!(
            "column key must be exactly {COLUMN_KEY_LEN} bytes (from Session::column_key), got {}",
            key.len()
        ))
    }
}

fn check_hash_token(token: &str) -> Result<(), String> {
    let ok = token.len().is_multiple_of(2)
        && token.len() <= MAX_TOKEN_HEX_LEN
        && token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    if ok {
        Ok(())
    } else {
        Err(format!(
            "token to re-encode must be lowercase hex of at most {MAX_TOKEN_HEX_LEN} characters and even length"
        ))
    }
}

#[wasm_bindgen]
pub struct Session {
    root: RootKey,
    salt: Vec<u8>,
}

#[wasm_bindgen]
pub fn session_from_passphrase(
    passphrase: &str,
    salt: &[u8],
    preset: &str,
) -> Result<Session, JsError> {
    if salt.len() != SALT_LEN {
        return Err(JsError::new(&format!("salt must be {SALT_LEN} bytes")));
    }
    let root =
        derive_root_key(passphrase.as_bytes(), salt, profile_for(preset)?).map_err(map_err)?;
    Ok(Session {
        root,
        salt: salt.to_vec(),
    })
}

#[wasm_bindgen]
pub fn session_from_master_key(key: &[u8], salt: &[u8]) -> Result<Session, JsError> {
    if salt.len() != SALT_LEN {
        return Err(JsError::new(&format!("salt must be {SALT_LEN} bytes")));
    }
    session_from_envelope(key, salt).map_err(map_err)
}

fn session_from_envelope(envelope: &[u8], salt: &[u8]) -> Result<Session, Error> {
    let parsed = anonymiser_core::parse_master_key(envelope)?;
    Ok(Session {
        root: anonymiser_core::derive_root_key_raw(&parsed.key, salt),
        salt: salt.to_vec(),
    })
}

const EPHEMERAL_SECRET_LEN: usize = 64;

#[wasm_bindgen]
pub fn session_ephemeral() -> Session {
    ephemeral_session(&mut UnwrapErr(SysRng))
}

fn ephemeral_session(rng: &mut impl Rng) -> Session {
    let mut secret = Zeroizing::new([0u8; EPHEMERAL_SECRET_LEN]);
    rng.fill_bytes(&mut secret[..]);
    let mut salt = vec![0u8; SALT_LEN];
    rng.fill_bytes(&mut salt);
    Session {
        root: anonymiser_core::derive_root_key_raw(&secret[..], &salt),
        salt,
    }
}

#[wasm_bindgen]
impl Session {
    pub fn column_key(&self, column: &str) -> Result<Vec<u8>, JsError> {
        anonymiser_core::column_key(&self.root, &self.salt, column)
            .map(|k| k.to_vec())
            .map_err(map_err)
    }

    pub fn column_key_scoped(&self, dataset: &str, column: &str) -> Result<Vec<u8>, JsError> {
        if dataset.is_empty() {
            return Err(JsError::new(
                "dataset must be a non-empty id; omit scoping for dataset-less runs",
            ));
        }
        anonymiser_core::column_key_scoped(&self.root, &self.salt, dataset, column)
            .map(|k| k.to_vec())
            .map_err(map_err)
    }
}

#[wasm_bindgen]
pub fn apply_policy(value: &str, policy: &str) -> Result<String, JsError> {
    let policy = parse_policy(policy)?;
    anonymiser_core::apply(value, policy, None, DEFAULT_TOKEN_BYTES).map_err(map_err)
}

#[wasm_bindgen]
pub fn apply_policy_keyed(
    value: &str,
    policy: &str,
    column_key: &[u8],
    token_bytes: usize,
) -> Result<String, JsError> {
    let policy = parse_policy(policy)?;
    check_column_key(column_key).map_err(|m| JsError::new(&m))?;
    anonymiser_core::apply(value, policy, Some(column_key), token_bytes).map_err(map_err)
}

#[wasm_bindgen]
pub fn apply_policy_keyed_typed(
    value: &str,
    policy: &str,
    column_key: &[u8],
    token_bytes: usize,
    canon_type: &str,
) -> Result<String, JsError> {
    let policy = parse_policy(policy)?;
    let ty = parse_canon_type(canon_type)?;
    check_column_key(column_key).map_err(|m| JsError::new(&m))?;
    apply_typed(value, policy, Some(column_key), token_bytes, ty).map_err(map_err)
}

#[wasm_bindgen]
pub fn apply_policy_generalised(
    value: &str,
    policy: &str,
    width: Option<u32>,
    reference_date: Option<String>,
) -> Result<String, JsError> {
    apply_generalised(value, policy, width, reference_date.as_deref()).map_err(map_err)
}

fn apply_generalised(
    value: &str,
    policy: &str,
    width: Option<u32>,
    reference_date: Option<&str>,
) -> Result<String, Error> {
    let reference = reference_date.map(str::parse::<Date>).transpose()?;
    let policy = Policy::from_str(policy)?.with_params(width, reference)?;
    anonymiser_core::apply(value, policy, None, DEFAULT_TOKEN_BYTES)
}

#[wasm_bindgen]
pub fn reencode_token_str(
    token: &str,
    policy: &str,
    token_encoding: &str,
) -> Result<String, JsError> {
    let policy = parse_policy(policy)?;
    let enc = parse_token_encoding(token_encoding)?;
    if enc == TokenEncoding::Base32 && policy == Policy::Hash && !token.is_empty() {
        check_hash_token(token).map_err(|m| JsError::new(&m))?;
    }
    Ok(reencode_token(token, policy, enc))
}

#[wasm_bindgen]
pub fn apply_policy_legacy(
    value: &str,
    policy: &str,
    legacy_key: &[u8],
) -> Result<String, JsError> {
    let policy = parse_policy(policy)?;
    if policy.key_material() != anonymiser_core::KeyMaterial::Passphrase {
        return Err(JsError::new(&format!(
            "policy {policy:?} is not a legacy passphrase policy"
        )));
    }
    anonymiser_core::apply(value, policy, Some(legacy_key), DEFAULT_TOKEN_BYTES).map_err(map_err)
}

#[wasm_bindgen]
pub fn decrypt_value(value: &str, column_key: &[u8]) -> Result<String, JsError> {
    anonymiser_core::decrypt_any(value, Some(column_key), None).map_err(map_err)
}

#[wasm_bindgen]
pub fn decrypt_legacy_value(value: &str, legacy_key: &[u8]) -> Result<String, JsError> {
    anonymiser_core::decrypt_any(value, None, Some(legacy_key)).map_err(map_err)
}

#[wasm_bindgen]
pub fn decrypt_any_value(
    value: &str,
    column_key: Option<Vec<u8>>,
    legacy_key: Option<Vec<u8>>,
) -> Result<String, JsError> {
    anonymiser_core::decrypt_any(value, column_key.as_deref(), legacy_key.as_deref())
        .map_err(map_err)
}

#[wasm_bindgen]
pub fn policy_vocabulary() -> Vec<String> {
    anonymiser_core::POLICY_VOCABULARY
        .iter()
        .map(|s| s.to_string())
        .collect()
}

#[wasm_bindgen]
pub fn deprecated_policy_vocabulary() -> Vec<String> {
    anonymiser_core::DEPRECATED_POLICY_VOCABULARY
        .iter()
        .map(|s| s.to_string())
        .collect()
}

const KEY_MATERIAL_VOCABULARY: [&str; 3] = ["none", "column", "passphrase"];

#[wasm_bindgen]
pub fn key_material_vocabulary() -> Vec<String> {
    KEY_MATERIAL_VOCABULARY
        .iter()
        .map(|s| s.to_string())
        .collect()
}

#[wasm_bindgen]
pub fn policy_key_material(policy: &str) -> Result<String, JsError> {
    use anonymiser_core::KeyMaterial;
    let p = parse_policy(policy)?;
    let m = match p.key_material() {
        KeyMaterial::None => KEY_MATERIAL_VOCABULARY[0],
        KeyMaterial::ColumnKey => KEY_MATERIAL_VOCABULARY[1],
        KeyMaterial::Passphrase => KEY_MATERIAL_VOCABULARY[2],
    };
    Ok(m.to_string())
}

#[wasm_bindgen]
pub fn is_encrypted_value(value: &str) -> bool {
    anonymiser_core::is_encrypted(value)
}
fn parse_policy(s: &str) -> Result<Policy, JsError> {
    Policy::from_str(s).map_err(map_err)
}

fn parse_canon_type(s: &str) -> Result<CanonType, JsError> {
    CanonType::from_str(s).map_err(map_err)
}

fn parse_token_encoding(s: &str) -> Result<TokenEncoding, JsError> {
    TokenEncoding::from_str(s).map_err(map_err)
}

#[wasm_bindgen]
pub fn canonicalize_value(value: &str) -> String {
    anonymiser_core::canonicalize(value)
}

#[wasm_bindgen]
pub fn generate_salt() -> Vec<u8> {
    let mut s = vec![0u8; SALT_LEN];
    UnwrapErr(SysRng).fill_bytes(&mut s);
    s
}

mod anonymity;
mod table;

#[cfg(test)]
mod tests;
