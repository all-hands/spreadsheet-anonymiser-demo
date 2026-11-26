use regex::Regex;
use std::fmt;
use std::str::FromStr;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

use crate::Error;

static WS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static EMAIL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([a-z0-9_.+-]+)@([a-z0-9.-]+)$").unwrap());
static PHONE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\+?[0-9 ()-]+$").unwrap());

pub fn canonicalize(s: &str) -> String {
    let s = normalise_text(s);

    if let Some(caps) = EMAIL.captures(&s) {
        let local = caps.get(1).unwrap().as_str();
        let domain = caps.get(2).unwrap().as_str();
        let local_norm = if is_gmail(domain) {
            local.replace('.', "")
        } else {
            local.to_string()
        };
        return format!("{}@{}", local_norm, domain);
    }

    if PHONE.is_match(&s) {
        return digits_and_plus(&s);
    }

    s
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum CanonType {
    #[default]
    Auto,
    Text,
    Email,
    Phone,
    Id,
}

pub const CANON_TYPE_VOCABULARY: &[&str] = &["auto", "text", "email", "phone", "id"];

impl CanonType {
    pub fn as_str(self) -> &'static str {
        match self {
            CanonType::Auto => "auto",
            CanonType::Text => "text",
            CanonType::Email => "email",
            CanonType::Phone => "phone",
            CanonType::Id => "id",
        }
    }
}

impl FromStr for CanonType {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "auto" => Ok(CanonType::Auto),
            "text" => Ok(CanonType::Text),
            "email" => Ok(CanonType::Email),
            "phone" => Ok(CanonType::Phone),
            "id" => Ok(CanonType::Id),
            other => Err(Error::UnknownCanonType(other.to_string())),
        }
    }
}

impl fmt::Display for CanonType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

pub fn canonicalize_typed(s: &str, ty: CanonType) -> String {
    match ty {
        CanonType::Auto => canonicalize(s),
        CanonType::Id => s.trim().to_string(),
        CanonType::Text => normalise_text(s),
        CanonType::Email => {
            let s = normalise_text(s);
            if let Some(caps) = EMAIL.captures(&s) {
                let local = caps.get(1).unwrap().as_str();
                let domain = caps.get(2).unwrap().as_str();
                if is_gmail(domain) {
                    let local = local.split('+').next().unwrap_or(local);
                    return format!("{}@{}", local.replace('.', ""), domain);
                }
            }
            s
        }
        CanonType::Phone => {
            let t = s.trim();
            let digits: String = t.chars().filter(|c| c.is_ascii_digit()).collect();
            if t.starts_with('+') {
                format!("+{digits}")
            } else {
                digits
            }
        }
    }
}

fn is_gmail(domain: &str) -> bool {
    domain.ends_with("gmail.com") || domain.ends_with("googlemail.com")
}

fn normalise_text(s: &str) -> String {
    let s = s.trim().nfc().collect::<String>().to_lowercase();
    WS.replace_all(&s, " ").to_string()
}

fn digits_and_plus(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_digit() || *c == '+')
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vocabulary_round_trips() {
        for s in CANON_TYPE_VOCABULARY {
            let ty = CanonType::from_str(s).unwrap_or_else(|e| panic!("vocabulary {s:?}: {e}"));
            assert_eq!(ty.as_str(), *s, "spelling drift for {s:?}");
            assert_eq!(ty.to_string(), *s);
            assert_eq!(CanonType::from_str(&ty.to_string()).unwrap(), ty);
        }
        assert!(CanonType::from_str("nope").is_err());
        assert!(CanonType::from_str("Auto").is_err());
    }

    #[test]
    fn typed_canonicalization_table() {
        let t = |s, ty| canonicalize_typed(s, ty);
        assert_eq!(t("2026-07-08", CanonType::Text), "2026-07-08");
        assert_eq!(t("2026-07-08", CanonType::Id), "2026-07-08");
        assert_eq!(t("2026-07-08", CanonType::Auto), "20260708");
        assert_eq!(t("+44 161 1234567", CanonType::Phone), "+441611234567");
        assert_eq!(t("(210) 123-4567", CanonType::Phone), "2101234567");
        assert_eq!(t(" AB12 ", CanonType::Id), "AB12");
        assert_ne!(t("AB12", CanonType::Id), t("ab12", CanonType::Id));
        assert_eq!(t(" AB12 ", CanonType::Text), "ab12");
        assert_eq!(
            t("j.doe+spam@GMAIL.com", CanonType::Email),
            "jdoe@gmail.com"
        );
        assert_eq!(t("  J.Doe@GMAIL.com ", CanonType::Email), "jdoe@gmail.com");
        assert_eq!(
            t("j.doe+spam@company.com", CanonType::Email),
            "j.doe+spam@company.com"
        );
        assert_eq!(t("123-45", CanonType::Email), "123-45");
        let composed = "José";
        let decomposed = "Jose\u{301}";
        assert_eq!(t(composed, CanonType::Text), t(decomposed, CanonType::Text));
    }
}
