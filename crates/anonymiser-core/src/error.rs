use crate::canon::CANON_TYPE_VOCABULARY;
use crate::token::{MAX_TOKEN_BYTES, TOKEN_ENCODING_VOCABULARY};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid Argon2 parameters")]
    Argon2Params,
    #[error("Argon2 derivation failed")]
    Argon2Derive,
    #[error("HKDF expand failed")]
    HkdfExpand,
    #[error("policy requires a keyed session (passphrase)")]
    MissingKey,
    #[error(
        "ciphertext cell has no key material (column key for \
         enc:v1:/kyber:v1:, the old global key for enc:/qenc:)"
    )]
    MissingDecryptKey,
    #[error("decryption failed (wrong key or corrupted data)")]
    DecryptFailed,
    #[error("value is not in enc:v1: format")]
    NotEncrypted,
    #[error("token length {0} out of range 1..={max} bytes", max = MAX_TOKEN_BYTES)]
    TokenBytes(usize),
    #[error("master-key file has wrong length {0}")]
    KeyLen(usize),
    #[error("not a master-key file (missing CSVANON magic) \u{2014} run `anonymiser keygen`")]
    NotAKeyFile,
    #[error("unsupported master-key envelope version {0}")]
    KeyVersion(u16),
    #[error("master-key envelope corrupt (checksum mismatch)")]
    KeyChecksum,
    #[error("unknown policy {0:?}")]
    UnknownPolicy(String),
    #[error("unknown canon type {0:?} ({vocab})", vocab = CANON_TYPE_VOCABULARY.join("|"))]
    UnknownCanonType(String),
    #[error("unknown token encoding {0:?} ({vocab})", vocab = TOKEN_ENCODING_VOCABULARY.join("|"))]
    UnknownTokenEncoding(String),
    #[error(
        "age-band needs a reference date (yyyy-mm-dd): \
         output must not depend on today's date"
    )]
    MissingReferenceDate,
    #[error("{0}")]
    InvalidParam(String),
    #[error("dataset/column names must not contain NUL bytes")]
    NulInKeyName,
    #[error("dataset namespace must not be empty; omit it for unscoped keys")]
    EmptyDataset,
    #[error("only a 64-byte key can be wrapped in a v1 envelope (found {0} bytes)")]
    KeyNotEnvelopable(usize),
    #[error("{0}")]
    DeprecatedPolicy(&'static str),
}
