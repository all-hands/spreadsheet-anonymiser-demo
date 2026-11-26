use anonymiser_core::{CanonType, Date, Policy};
use anyhow::{anyhow, Result};
use std::str::FromStr;

#[derive(serde::Deserialize, Debug)]
pub struct PolicyFile {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub columns: Vec<PolicyFileColumn>,
}

#[derive(serde::Deserialize, Debug)]
pub struct PolicyFileColumn {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub index: Option<usize>,
    pub action: String,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub reference_date: Option<String>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct GenParams {
    pub width: Option<u32>,
    pub reference: Option<Date>,
}

impl GenParams {
    pub fn fill(
        &self,
        policy: Policy,
        width: Option<u32>,
        reference: Option<Date>,
    ) -> Result<Policy> {
        let (width, reference) = match policy {
            Policy::AgeBand { .. } => (width.or(self.width), reference.or(self.reference)),
            Policy::Bucket { .. } => (width.or(self.width), reference),
            _ => (width, reference),
        };
        policy
            .with_params(width, reference)
            .map_err(|e| anyhow!("{e}"))
    }
}

pub fn parse_reference_date(s: &str) -> Result<Date> {
    Date::from_str(s).map_err(|e| anyhow!("{e}"))
}

pub fn require_reference_dates(policies: &[Policy], headers: &csv::StringRecord) -> Result<()> {
    for (p, h) in policies.iter().zip(headers.iter()) {
        if matches!(
            p,
            Policy::AgeBand {
                reference: None,
                ..
            }
        ) {
            anyhow::bail!(
                "column {h:?} uses age-band, which needs a reference date: pass \
                 --reference-date yyyy-mm-dd (or \"reference_date\" in the policy file). \
                 There is no default — output must not depend on today's date"
            );
        }
    }
    Ok(())
}

pub fn parse_canon_type(s: &str) -> Result<CanonType> {
    CanonType::from_str(s).map_err(|e| anyhow!("{e}"))
}

pub fn canon_type_name(t: CanonType) -> &'static str {
    t.as_str()
}

pub fn parse_policy_string(s: &str) -> Result<Policy> {
    Policy::from_str(s).map_err(|_| anyhow!("unknown policy {s:?} in policy file"))
}

pub fn policy_name(p: Policy) -> &'static str {
    p.as_str()
}

pub fn policy_label(p: Policy) -> String {
    match p {
        Policy::AgeBand { width, reference } => format!(
            "age-band[width={width},ref={}]",
            reference.map_or_else(|| "?".to_string(), |d| d.to_string())
        ),
        Policy::Bucket { width } => format!("bucket[width={width}]"),
        _ => p.as_str().to_string(),
    }
}

pub type ColumnPlan = (
    Vec<Policy>,
    Vec<Option<String>>,
    Vec<anonymiser_core::CanonType>,
);

pub fn policies_from_file(
    file: &PolicyFile,
    headers: &csv::StringRecord,
    defaults: &GenParams,
) -> Result<ColumnPlan> {
    let mut out = vec![Policy::Keep; headers.len()];
    let mut groups = vec![None; headers.len()];
    let mut types = vec![anonymiser_core::CanonType::Auto; headers.len()];
    for col in &file.columns {
        let idx = match (col.index, &col.name) {
            (Some(i), _) => i,
            (None, Some(name)) => headers
                .iter()
                .position(|h| h == name)
                .or_else(|| headers.iter().position(|h| h.eq_ignore_ascii_case(name)))
                .ok_or_else(|| anyhow!("policy file column {name:?} not found in CSV headers"))?,
            (None, None) => {
                return Err(anyhow!("policy file column needs a name or index"));
            }
        };
        if idx >= out.len() {
            return Err(anyhow!("policy file column index {idx} out of bounds"));
        }
        let reference = col
            .reference_date
            .as_deref()
            .map(parse_reference_date)
            .transpose()?;
        out[idx] = defaults
            .fill(parse_policy_string(&col.action)?, col.width, reference)
            .map_err(|e| anyhow!("policy file column {idx}: {e}"))?;
        groups[idx] = col.group.clone();
        types[idx] = match &col.r#type {
            Some(t) => parse_canon_type(t)?,
            None => anonymiser_core::CanonType::Auto,
        };
    }
    Ok((out, groups, types))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::args::{PolicyArg, TokenEncodingArg};
    use anonymiser_core::TokenEncoding;
    use clap::ValueEnum;

    #[test]
    fn name_entry_prefers_exact_header_over_case_variant() {
        let file: PolicyFile =
            serde_json::from_str(r#"{"columns":[{"name":"email","action":"redact"}]}"#).unwrap();
        let headers = csv::StringRecord::from(vec!["EMAIL", "email"]);
        let (pols, _, _) = policies_from_file(&file, &headers, &GenParams::default()).unwrap();
        assert!(matches!(pols[0], Policy::Keep));
        assert!(!matches!(pols[1], Policy::Keep));
    }

    #[test]
    fn vocabulary_round_trips() {
        for w in anonymiser_core::POLICY_VOCABULARY {
            let p = parse_policy_string(w).unwrap();
            assert_eq!(policy_name(p), *w, "vocabulary drift for {w}");
        }
        assert!(parse_policy_string("nope").is_err());
    }

    #[test]
    fn clap_shims_parse_through_the_core_vocabulary() {
        for v in PolicyArg::value_variants() {
            let pv = v.to_possible_value().expect("derived ValueEnum");
            assert!(
                Policy::from_str(pv.get_name()).is_ok(),
                "--policy value {:?} left the core vocabulary",
                pv.get_name()
            );
        }
        for v in TokenEncodingArg::value_variants() {
            let pv = v.to_possible_value().expect("derived ValueEnum");
            assert!(
                TokenEncoding::from_str(pv.get_name()).is_ok(),
                "alphabet {:?} left the core vocabulary",
                pv.get_name()
            );
        }
    }

    #[test]
    fn inspect_allowlist_is_a_subset_of_the_policy_flag() {
        for p in crate::plan::INSPECT_POLICIES {
            assert!(
                PolicyArg::from_str(p.as_str(), false).is_ok(),
                "allowed policy {} is not a --policy value",
                p.as_str()
            );
        }
    }

    #[test]
    fn every_generalisation_is_a_policy_flag_value() {
        for w in anonymiser_core::POLICY_VOCABULARY {
            if Policy::from_str(w).unwrap().is_generalisation() {
                assert!(PolicyArg::from_str(w, false).is_ok(), "--policy {w}");
            }
        }
    }

    #[test]
    fn column_params_beat_defaults_and_defaults_skip_other_policies() {
        let d = parse_reference_date("2026-01-01").unwrap();
        let defaults = GenParams {
            width: Some(20),
            reference: Some(d),
        };
        let ab = Policy::from_str("age-band").unwrap();
        let col = parse_reference_date("2030-06-01").unwrap();
        assert_eq!(
            defaults.fill(ab, Some(5), Some(col)).unwrap(),
            Policy::AgeBand {
                width: 5,
                reference: Some(col)
            }
        );
        assert_eq!(
            defaults.fill(ab, None, None).unwrap(),
            Policy::AgeBand {
                width: 20,
                reference: Some(d)
            }
        );
        assert_eq!(
            defaults.fill(Policy::Year, None, None).unwrap(),
            Policy::Year
        );
        assert_eq!(
            defaults.fill(Policy::Hash, None, None).unwrap(),
            Policy::Hash
        );
        assert!(defaults.fill(Policy::Year, Some(5), None).is_err());
        assert!(parse_reference_date("2026-13-01").is_err());
    }

    #[test]
    fn labels_record_the_parameters_in_force() {
        let ab = Policy::AgeBand {
            width: 10,
            reference: Some(parse_reference_date("2026-01-01").unwrap()),
        };
        assert_eq!(policy_label(ab), "age-band[width=10,ref=2026-01-01]");
        assert_eq!(policy_label(Policy::Bucket { width: 5 }), "bucket[width=5]");
        assert_eq!(policy_label(Policy::Year), "year");
        assert_eq!(policy_label(Policy::Hash), "hash");
    }
}
