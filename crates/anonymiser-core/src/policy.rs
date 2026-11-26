use crate::canon::{canonicalize_typed, CanonType};
use crate::cell::encrypt_cell;
use crate::generalise::{apply_generalisation, Date, DEFAULT_WIDTH};
use crate::legacy::{legacy_encrypt_cell, legacy_hmac_sha256, legacy_mask, legacy_sha256};
use crate::token::{hash_cell, hash_cell_unkeyed, TokenEncoding};
use crate::Error;
use std::fmt;
use std::str::FromStr;

pub const REDACTED: &str = "[REDACTED]";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Policy {
    Keep,
    Redact,
    Mask(MaskKind),
    Hash,
    Faux,
    Year,
    AgeBand { width: u32, reference: Option<Date> },
    Bucket { width: u32 },
    Encrypt,
    KyberAes,
    LegacyHmacSha256,
    LegacySha256,
    LegacyMask,
    LegacyAes,
    LegacyKyberAes,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyMaterial {
    None,
    ColumnKey,
    Passphrase,
}

impl Policy {
    pub fn key_material(self) -> KeyMaterial {
        match self {
            Policy::Keep | Policy::Redact | Policy::Mask(_) | Policy::Faux => KeyMaterial::None,
            Policy::Year | Policy::AgeBand { .. } | Policy::Bucket { .. } => KeyMaterial::None,
            Policy::Hash => KeyMaterial::ColumnKey,
            Policy::Encrypt | Policy::KyberAes => KeyMaterial::ColumnKey,
            Policy::LegacyHmacSha256 | Policy::LegacyAes | Policy::LegacyKyberAes => {
                KeyMaterial::Passphrase
            }
            Policy::LegacySha256 | Policy::LegacyMask => KeyMaterial::None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MaskKind {
    Auto,
    Email,
    Last4,
}

pub const POLICY_VOCABULARY: &[&str] = &[
    "keep",
    "redact",
    "mask",
    "mask-email",
    "mask-last4",
    "hash",
    "faux",
    "year",
    "age-band",
    "bucket",
    "encrypt",
    "kyber-aes",
    "legacy-hmac-sha256",
    "legacy-sha256",
    "legacy-mask",
    "legacy-aes",
    "legacy-kyber-aes",
];

pub const DEPRECATED_POLICY_VOCABULARY: &[&str] = &["kyber-aes"];

const KYBER_AES_NOTICE: &str = "policy \"kyber-aes\" is deprecated and refused for new runs: \
     its ML-KEM layer is keyed from the column key, so it adds no protection over \
     AES-256-GCM; use \"encrypt\" instead (existing kyber:v1: cells still decrypt)";

impl Policy {
    pub fn deprecation_notice(self) -> Option<&'static str> {
        match self {
            Policy::KyberAes => Some(KYBER_AES_NOTICE),
            _ => None,
        }
    }

    pub fn is_deprecated(self) -> bool {
        self.deprecation_notice().is_some()
    }

    pub fn for_new_run(self) -> Result<Self, Error> {
        match self.deprecation_notice() {
            Some(notice) => Err(Error::DeprecatedPolicy(notice)),
            None => Ok(self),
        }
    }
}

impl Policy {
    pub fn as_str(self) -> &'static str {
        match self {
            Policy::Keep => "keep",
            Policy::Redact => "redact",
            Policy::Mask(MaskKind::Auto) => "mask",
            Policy::Mask(MaskKind::Email) => "mask-email",
            Policy::Mask(MaskKind::Last4) => "mask-last4",
            Policy::Hash => "hash",
            Policy::Faux => "faux",
            Policy::Year => "year",
            Policy::AgeBand { .. } => "age-band",
            Policy::Bucket { .. } => "bucket",
            Policy::Encrypt => "encrypt",
            Policy::KyberAes => "kyber-aes",
            Policy::LegacyHmacSha256 => "legacy-hmac-sha256",
            Policy::LegacySha256 => "legacy-sha256",
            Policy::LegacyMask => "legacy-mask",
            Policy::LegacyAes => "legacy-aes",
            Policy::LegacyKyberAes => "legacy-kyber-aes",
        }
    }
}

impl Policy {
    pub fn with_params(self, width: Option<u32>, reference: Option<Date>) -> Result<Policy, Error> {
        if width == Some(0) {
            return Err(Error::InvalidParam("width must be at least 1".into()));
        }
        let misplaced = |what: &str| {
            Error::InvalidParam(format!(
                "{what} does not apply to policy {:?}",
                self.as_str()
            ))
        };
        match self {
            Policy::AgeBand {
                width: w,
                reference: r,
            } => Ok(Policy::AgeBand {
                width: width.unwrap_or(w),
                reference: reference.or(r),
            }),
            Policy::Bucket { width: w } if reference.is_none() => Ok(Policy::Bucket {
                width: width.unwrap_or(w),
            }),
            Policy::Bucket { .. } => Err(misplaced("reference_date")),
            _ if width.is_some() => Err(misplaced("width")),
            _ if reference.is_some() => Err(misplaced("reference_date")),
            _ => Ok(self),
        }
    }

    pub(crate) fn generalisation(self) -> Option<Generalisation> {
        match self {
            Policy::Year => Some(Generalisation::Year),
            Policy::AgeBand { width, reference } => {
                Some(Generalisation::AgeBand { width, reference })
            }
            Policy::Bucket { width } => Some(Generalisation::Bucket { width }),
            Policy::Keep
            | Policy::Redact
            | Policy::Mask(_)
            | Policy::Hash
            | Policy::Faux
            | Policy::Encrypt
            | Policy::KyberAes
            | Policy::LegacyHmacSha256
            | Policy::LegacySha256
            | Policy::LegacyMask
            | Policy::LegacyAes
            | Policy::LegacyKyberAes => None,
        }
    }

    pub fn is_generalisation(self) -> bool {
        self.generalisation().is_some()
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum Generalisation {
    Year,
    AgeBand { width: u32, reference: Option<Date> },
    Bucket { width: u32 },
}

impl FromStr for Policy {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "keep" => Ok(Policy::Keep),
            "redact" => Ok(Policy::Redact),
            "mask" => Ok(Policy::Mask(MaskKind::Auto)),
            "mask-email" => Ok(Policy::Mask(MaskKind::Email)),
            "mask-last4" => Ok(Policy::Mask(MaskKind::Last4)),
            "hash" => Ok(Policy::Hash),
            "faux" => Ok(Policy::Faux),
            "year" => Ok(Policy::Year),
            "age-band" => Ok(Policy::AgeBand {
                width: DEFAULT_WIDTH,
                reference: None,
            }),
            "bucket" => Ok(Policy::Bucket {
                width: DEFAULT_WIDTH,
            }),
            "encrypt" => Ok(Policy::Encrypt),
            "kyber-aes" => Ok(Policy::KyberAes),
            "legacy-hmac-sha256" => Ok(Policy::LegacyHmacSha256),
            "legacy-sha256" => Ok(Policy::LegacySha256),
            "legacy-mask" => Ok(Policy::LegacyMask),
            "legacy-aes" => Ok(Policy::LegacyAes),
            "legacy-kyber-aes" => Ok(Policy::LegacyKyberAes),
            other => Err(Error::UnknownPolicy(other.to_string())),
        }
    }
}

impl fmt::Display for Policy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

pub fn apply(
    value: &str,
    policy: Policy,
    column_key: Option<&[u8]>,
    token_bytes: usize,
) -> Result<String, Error> {
    apply_typed(value, policy, column_key, token_bytes, CanonType::Auto)
}

pub fn apply_typed(
    value: &str,
    policy: Policy,
    column_key: Option<&[u8]>,
    token_bytes: usize,
    ty: CanonType,
) -> Result<String, Error> {
    let policy = policy.for_new_run()?;
    if value.is_empty() {
        return Ok(String::new());
    }
    match policy {
        Policy::Keep => Ok(value.to_string()),
        Policy::Redact => Ok(REDACTED.to_string()),
        Policy::Mask(kind) => Ok(mask(value, kind)),
        Policy::Hash => {
            let canonical = canonicalize_typed(value, ty);
            if canonical.is_empty() {
                return Ok(String::new());
            }
            Ok(match column_key {
                Some(k) => hash_cell(&canonical, k, token_bytes)?,
                None => hash_cell_unkeyed(value),
            })
        }
        Policy::Faux => Ok(faux(value)),
        Policy::Year => apply_generalisation(value, Generalisation::Year),
        Policy::AgeBand { width, reference } => {
            apply_generalisation(value, Generalisation::AgeBand { width, reference })
        }
        Policy::Bucket { width } => apply_generalisation(value, Generalisation::Bucket { width }),
        Policy::Encrypt => {
            let key = column_key.ok_or(Error::MissingKey)?;
            let mut nonce = [0u8; 12];
            getrandom::fill(&mut nonce).expect("OS RNG");
            encrypt_cell(value, key, &nonce)
        }
        Policy::KyberAes => unreachable!("refused by for_new_run above"),
        Policy::LegacyHmacSha256 => Ok(legacy_hmac_sha256(
            value,
            column_key.ok_or(Error::MissingKey)?,
        )),
        Policy::LegacySha256 => Ok(legacy_sha256(value)),
        Policy::LegacyMask => Ok(legacy_mask(value)),
        Policy::LegacyAes => {
            legacy_encrypt_cell(value, column_key.ok_or(Error::MissingKey)?, false)
        }
        Policy::LegacyKyberAes => {
            legacy_encrypt_cell(value, column_key.ok_or(Error::MissingKey)?, true)
        }
    }
}

pub fn reencode_token(token: &str, policy: Policy, enc: TokenEncoding) -> String {
    if enc == TokenEncoding::Base32 && policy == Policy::Hash && !token.is_empty() {
        let bytes = hex::decode(token).expect("hash tokens are lowercase hex");
        crate::token::encode_token(&bytes, enc)
    } else {
        token.to_string()
    }
}

pub fn mask(value: &str, kind: MaskKind) -> String {
    if value.is_empty() {
        return String::new();
    }
    match kind {
        MaskKind::Email => {
            if let Some(idx) = value.find('@') {
                let domain = &value[idx..];
                let local = &value[..idx];
                let mut chars = local.chars();
                let Some(first) = chars.next() else {
                    return format!("*{}", domain);
                };
                let rest = chars.count();
                if rest == 0 {
                    return format!("*{}", domain);
                }
                format!("{}{}{}", first, "*".repeat(rest), domain)
            } else {
                "[INVALID EMAIL]".to_string()
            }
        }
        MaskKind::Last4 => {
            let len = value.chars().count();
            if len <= 4 {
                return value.to_string();
            }
            let visible: String = value.chars().skip(len - 4).collect();
            let masked = "*".repeat(len - 4);
            format!("{}{}", masked, visible)
        }
        MaskKind::Auto => {
            if value.contains('@') {
                mask(value, MaskKind::Email)
            } else if value.chars().all(|c| c.is_numeric() || "()-+ ".contains(c)) {
                mask(value, MaskKind::Last4)
            } else {
                REDACTED.to_string()
            }
        }
    }
}

pub fn faux(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    if value.contains('@') {
        "faux_user@example.com".to_string()
    } else if value.chars().all(|c| c.is_numeric() || "()-+ ".contains(c)) {
        "0000000000".to_string()
    } else {
        "FAUX_DATA".to_string()
    }
}

#[cfg(test)]
#[path = "policy_tests.rs"]
mod tests;
