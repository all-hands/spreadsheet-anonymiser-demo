use crate::manifest::{sha256_file, Manifest, MANIFEST_SCHEMA};
use crate::policy_file::ColumnPlan;
use crate::salt_file::salt_id;
use anonymiser_core::{key_fingerprint, CanonType, Policy, TokenEncoding};
use anyhow::{anyhow, bail, Result};
use std::path::Path;
use std::str::FromStr;

pub(crate) struct Check {
    pub(crate) ok: bool,
    pub(crate) msg: String,
}

fn check(ok: bool, pass: impl Into<String>, fail: impl Into<String>) -> Check {
    Check {
        ok,
        msg: if ok { pass.into() } else { fail.into() },
    }
}

pub(crate) struct Settings {
    pub(crate) dataset: Option<String>,
    pub(crate) token_bytes: usize,
    pub(crate) enc: TokenEncoding,
}

pub(crate) fn resolve(
    m: Option<&Manifest>,
    dataset: Option<&str>,
    token_bytes: Option<usize>,
    enc: Option<TokenEncoding>,
) -> (Settings, Vec<Check>) {
    let mut checks = Vec::new();
    let Some(m) = m else {
        return (
            Settings {
                dataset: dataset.map(str::to_string),
                token_bytes: token_bytes.unwrap_or(anonymiser_core::DEFAULT_TOKEN_BYTES),
                enc: enc.unwrap_or_default(),
            },
            checks,
        );
    };
    let enc_known = match TokenEncoding::from_str(&m.tokens.encoding) {
        Ok(_) => true,
        Err(e) => {
            checks.push(check(false, String::new(), e.to_string()));
            false
        }
    };
    let m_enc = TokenEncoding::from_str(&m.tokens.encoding).unwrap_or_default();
    if let Some(d) = dataset {
        checks.push(check(
            m.dataset.as_deref() == Some(d),
            format!("--dataset matches the manifest ({d:?})"),
            format!(
                "--dataset {d:?} disagrees with the manifest ({:?})",
                m.dataset
            ),
        ));
    }
    if let Some(b) = token_bytes {
        checks.push(check(
            b == m.tokens.bytes,
            format!("--token-bytes matches the manifest ({b})"),
            format!(
                "--token-bytes {b} disagrees with the manifest ({})",
                m.tokens.bytes
            ),
        ));
    }
    if let Some(e) = enc {
        checks.push(check(
            enc_known && e == m_enc,
            format!("--token-encoding matches the manifest ({e})"),
            if enc_known {
                format!("--token-encoding {e} disagrees with the manifest ({m_enc})")
            } else {
                format!(
                    "--token-encoding {e} cannot be compared: the manifest's encoding {:?} is unknown",
                    m.tokens.encoding
                )
            },
        ));
    }
    (
        Settings {
            dataset: dataset.map(str::to_string).or_else(|| m.dataset.clone()),
            token_bytes: token_bytes.unwrap_or(m.tokens.bytes),
            enc: enc.unwrap_or(m_enc),
        },
        checks,
    )
}

pub(crate) fn plan(m: &Manifest, headers: &csv::StringRecord) -> Result<ColumnPlan> {
    if m.columns.len() != headers.len()
        || m.columns
            .iter()
            .zip(headers.iter())
            .any(|(c, h)| c.name != h)
    {
        bail!("the manifest's columns do not match the output's header row");
    }
    let (mut policies, mut groups, mut canons) = (Vec::new(), Vec::new(), Vec::new());
    for c in &m.columns {
        let reference = c
            .reference_date
            .as_deref()
            .map(crate::policy_file::parse_reference_date)
            .transpose()
            .map_err(|e| anyhow!("manifest: column {:?}: {e}", c.name))?;
        policies.push(
            Policy::from_str(&c.policy)
                .map_err(|_| anyhow!("manifest: unknown policy {:?}", c.policy))?
                .with_params(c.width, reference)
                .map_err(|e| anyhow!("manifest: column {:?}: {e}", c.name))?,
        );
        canons.push(CanonType::from_str(&c.canon).map_err(|e| anyhow!("manifest: {e}"))?);
        groups.push(c.group.clone());
    }
    Ok((policies, groups, canons))
}

pub(crate) fn audit(
    m: &Manifest,
    outfile: &Path,
    out_rows: usize,
    salt: Option<&[u8]>,
    key: Option<&[u8]>,
    against: bool,
) -> Vec<Check> {
    let mut c = vec![check(
        m.schema_version == MANIFEST_SCHEMA,
        format!(
            "manifest schema v{} (tool {}, {})",
            m.schema_version, m.tool_version, m.created_utc
        ),
        format!("unexpected manifest schema v{}", m.schema_version),
    )];
    c.push(match sha256_file(outfile) {
        Ok(h) => check(
            h == m.output.sha256,
            "output SHA-256 matches the manifest",
            format!(
                "output SHA-256 {h} != manifest {} — the file changed since the run",
                m.output.sha256
            ),
        ),
        Err(e) => check(false, "", format!("cannot hash the output: {e}")),
    });
    c.push(check(
        out_rows == m.output.rows,
        format!("row count {out_rows} matches the manifest"),
        format!(
            "output has {out_rows} rows, the manifest recorded {}",
            m.output.rows
        ),
    ));
    match (salt, &m.salt.id) {
        (Some(s), Some(id)) => c.push(check(
            &salt_id(s) == id,
            format!("salt id {id} matches the manifest"),
            format!(
                "--salt-file has id {}, the manifest recorded {id}",
                salt_id(s)
            ),
        )),
        (Some(_), None) => c.push(check(
            false,
            "",
            "--salt-file given, but the manifest is of a --oneshot run (no salt id recorded)",
        )),
        _ => {}
    }
    if let (Some(k), Some(id)) = (key, &m.key_schedule.key_id) {
        c.push(check(
            &key_fingerprint(k) == id,
            format!("master-key fingerprint {id} matches the manifest"),
            format!(
                "master key has fingerprint {}, the manifest recorded {id}",
                key_fingerprint(k)
            ),
        ));
    }
    if against && m.suppression.is_some() {
        c.push(check(
            false,
            "",
            "the manifest records k-anonymity suppression; --against re-derives \
             policies only and does not model it"
                .to_string(),
        ));
    }
    if against {
        c.push(check(
            m.key_schedule.kdf == "hkdf-sha512",
            "key schedule hkdf-sha512 supports --against re-derivation",
            format!(
                "manifest records {}; --against re-derives master-key (hkdf-sha512) runs only",
                m.key_schedule.kdf
            ),
        ));
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::*;

    fn sample() -> Manifest {
        Manifest {
            kind: MANIFEST_KIND.into(),
            schema_version: MANIFEST_SCHEMA,
            tool_version: "0".into(),
            created_utc: "2026-01-01T00:00:00Z".into(),
            dataset: Some("ds".into()),
            oneshot: false,
            reversible: false,
            salt: SaltRecord {
                id: Some("abc".into()),
                format: "anonsalt-v1".into(),
            },
            key_schedule: KeyScheduleRecord {
                kdf: "hkdf-sha512".into(),
                argon2id: None,
                key_id: None,
            },
            tokens: TokensRecord {
                encoding: "base32".into(),
                bytes: 8,
            },
            columns: vec![ColumnRecord {
                index: 0,
                name: "email".into(),
                policy: "hash".into(),
                canon: "email".into(),
                group: Some("g".into()),
                width: None,
                reference_date: None,
            }],
            input: InputRecord {
                name: "in.csv".into(),
                sha256: None,
                rows: 1,
            },
            output: OutputRecord {
                name: "out.csv".into(),
                sha256: "00".into(),
                rows: 1,
            },
            suppression: None,
        }
    }

    #[test]
    fn settings_come_from_the_manifest_and_conflicts_fail() {
        let m = sample();
        let (s, checks) = resolve(Some(&m), None, None, None);
        assert_eq!(
            (s.token_bytes, s.enc.to_string()),
            (8, "base32".to_string())
        );
        assert_eq!(s.dataset.as_deref(), Some("ds"));
        assert!(checks.is_empty());
        let (_, checks) = resolve(Some(&m), Some("other"), Some(16), None);
        assert_eq!(checks.iter().filter(|c| !c.ok).count(), 2);
    }

    #[test]
    fn plan_roundtrips_and_rejects_foreign_headers() {
        let m = sample();
        let (p, g, c) = plan(&m, &csv::StringRecord::from(vec!["email"])).expect("plan");
        assert_eq!(
            (p, g, c),
            (
                vec![Policy::Hash],
                vec![Some("g".to_string())],
                vec![CanonType::Email]
            )
        );
        assert!(plan(&m, &csv::StringRecord::from(vec!["other"])).is_err());
    }

    #[test]
    fn plan_restores_generalisation_parameters() {
        let mut m = sample();
        m.columns[0].policy = "age-band".into();
        m.columns[0].width = Some(5);
        m.columns[0].reference_date = Some("2026-01-01".into());
        let (p, _, _) = plan(&m, &csv::StringRecord::from(vec!["email"])).expect("plan");
        assert_eq!(
            crate::policy_file::policy_label(p[0]),
            "age-band[width=5,ref=2026-01-01]"
        );
        m.columns[0].reference_date = Some("01/01/2026".into());
        assert!(plan(&m, &csv::StringRecord::from(vec!["email"])).is_err());
    }
}
