use crate::policy_file::{
    parse_canon_type, policies_from_file, policy_name, require_reference_dates, ColumnPlan,
    GenParams, PolicyFile,
};
use anonymiser_core::{CanonType, KeyMaterial, MaskKind, Policy};
use anyhow::{anyhow, Context, Result};
use std::fs;
use std::path::Path;
use std::str::FromStr;

pub(crate) const INSPECT_POLICIES: &[Policy] = &[
    Policy::Hash,
    Policy::Redact,
    Policy::Mask(MaskKind::Auto),
    Policy::Faux,
    Policy::Encrypt,
];

pub(crate) fn refuse_deprecated(
    policy: Policy,
    columns: &Option<String>,
    policy_file: Option<&Path>,
) -> Result<()> {
    let refuse = |p: Policy| p.for_new_run().map(drop).map_err(|e| anyhow!("{e}"));
    refuse(policy)?;
    for entry in columns.iter().flat_map(|c| c.split(',')) {
        if let Some((_, suffix)) = entry.trim().rsplit_once(':') {
            let name = suffix.split_once('=').map_or(suffix, |(n, _)| n);
            if let Ok(p) = Policy::from_str(name) {
                refuse(p)?;
            }
        }
    }
    if let Some(path) = policy_file {
        let file = fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str::<PolicyFile>(&raw).ok());
        for col in file.iter().flat_map(|f| &f.columns) {
            if let Ok(p) = Policy::from_str(&col.action) {
                refuse(p)?;
            }
        }
    }
    Ok(())
}

pub(crate) type Generalise = (Policy, Option<u32>);

pub(crate) struct Selected {
    pub(crate) idx: usize,
    pub(crate) canon: CanonType,
    pub(crate) generalise: Option<Generalise>,
}

fn parse_suffix(t: &str) -> Result<(CanonType, Option<Generalise>)> {
    let (name, width) = match t.split_once('=') {
        Some((n, w)) => (n, Some(w)),
        None => (t, None),
    };
    match Policy::from_str(name) {
        Ok(p) if p.is_deprecated() => Err(anyhow!("{}", p.for_new_run().unwrap_err())),
        Ok(p) if p.is_generalisation() => {
            let width = width
                .map(|w| {
                    w.parse::<u32>()
                        .map_err(|_| anyhow!("invalid width {w:?} (expected a whole number)"))
                })
                .transpose()?;
            Ok((CanonType::Auto, Some((p, width))))
        }
        _ if width.is_some() => Err(anyhow!(
            "{t:?}: only age-band and bucket take a width (name=width)"
        )),
        _ => parse_canon_type(t).map(|c| (c, None)).map_err(|e| {
            anyhow!("{e}; or a generalisation: year, age-band[=width], bucket[=width]")
        }),
    }
}

pub(crate) fn resolve_selection(
    columns: &Option<String>,
    headers: &csv::StringRecord,
    all_columns: bool,
) -> Result<Vec<Selected>> {
    let Some(cols) = columns else {
        if all_columns {
            return Ok((0..headers.len())
                .map(|idx| Selected {
                    idx,
                    canon: CanonType::Auto,
                    generalise: None,
                })
                .collect());
        }
        return Err(anyhow!(
            "no columns selected: pass --columns <names/indices>, --policy-file or --all-columns"
        ));
    };
    let mut out = Vec::new();
    for entry in cols.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let (name, (canon, generalise)) = match entry.rsplit_once(':') {
            Some((n, t)) => (n, parse_suffix(t)?),
            None => (entry, (CanonType::Auto, None)),
        };
        let idx = match name.parse::<usize>() {
            Ok(i) => {
                if i >= headers.len() {
                    return Err(anyhow!(
                        "column index {i} out of range (file has {} columns)",
                        headers.len()
                    ));
                }
                i
            }
            Err(_) => headers.iter().position(|h| h == name).ok_or_else(|| {
                anyhow!(
                    "column {name:?} not found; available headers: {}",
                    headers.iter().collect::<Vec<_>>().join(", ")
                )
            })?,
        };
        out.push(Selected {
            idx,
            canon,
            generalise,
        });
    }
    if out.is_empty() {
        return Err(anyhow!("--columns did not name any column"));
    }
    Ok(out)
}

/// SECURITY: `--quasi-identifiers` takes header names or 0-based indices, no suffixes.
/// Unknown names, out-of-range indices and duplicates are errors (fail
/// closed: a typo must not silently leave a column unprotected).
pub(crate) fn resolve_quasi_identifiers(
    spec: &str,
    headers: &csv::StringRecord,
) -> Result<Vec<usize>> {
    let mut out: Vec<usize> = Vec::new();
    for name in spec.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let idx = match name.parse::<usize>() {
            Ok(i) if i < headers.len() => i,
            Ok(i) => {
                return Err(anyhow!(
                    "--quasi-identifiers: column index {i} out of range (file has {} columns)",
                    headers.len()
                ))
            }
            Err(_) => headers.iter().position(|h| h == name).ok_or_else(|| {
                anyhow!(
                    "--quasi-identifiers: column {name:?} not found; available headers: {}",
                    headers.iter().collect::<Vec<_>>().join(", ")
                )
            })?,
        };
        if out.contains(&idx) {
            return Err(anyhow!(
                "--quasi-identifiers: column {idx} ({name:?}) is listed more than once"
            ));
        }
        out.push(idx);
    }
    if out.is_empty() {
        return Err(anyhow!("--quasi-identifiers did not name any column"));
    }
    Ok(out)
}

pub(crate) fn resolve_columns(
    columns: &Option<String>,
    headers: &csv::StringRecord,
    all_columns: bool,
) -> Result<Vec<(usize, CanonType)>> {
    resolve_selection(columns, headers, all_columns)?
        .into_iter()
        .map(|s| match s.generalise {
            Some((p, _)) => Err(anyhow!(
                "--columns suffix {p} is a generalisation policy; it has no tokens to verify \
                 (pass --manifest or --policy-file instead: they record its parameters, and \
                 --against then re-computes it)"
            )),
            None => Ok((s.idx, s.canon)),
        })
        .collect()
}

pub(crate) struct ColumnPlanFlags<'a> {
    pub(crate) columns: &'a Option<String>,
    pub(crate) policy: Policy,
    pub(crate) join_group: Option<&'a str>,
    pub(crate) all_columns: bool,
    pub(crate) policy_file: Option<&'a Path>,
    pub(crate) params: GenParams,
    pub(crate) select_all: bool,
}

pub(crate) fn build_column_plan(
    flags: &ColumnPlanFlags<'_>,
    headers: &csv::StringRecord,
    allowed_policies: Option<&[Policy]>,
) -> Result<ColumnPlan> {
    let ColumnPlanFlags {
        columns,
        policy,
        join_group,
        all_columns,
        policy_file,
        params,
        select_all,
    } = *flags;
    let plan = if let Some(path) = policy_file {
        let raw = fs::read_to_string(path).with_context(|| format!("read policy file {path:?}"))?;
        let file: PolicyFile =
            serde_json::from_str(&raw).with_context(|| format!("parse policy file {path:?}"))?;
        if file.version > 1 {
            anyhow::bail!("unsupported policy file version {}", file.version);
        }
        policies_from_file(&file, headers, &params)?
    } else {
        let selected = if select_all {
            resolve_selection(&None, headers, true)?
        } else {
            resolve_selection(columns, headers, all_columns)?
        };
        if let Some(allowed) = allowed_policies {
            if !allowed.contains(&policy) && !policy.is_generalisation() {
                anyhow::bail!(
                    "--policy {} is not supported by inspect (allowed: {})",
                    policy,
                    allowed
                        .iter()
                        .map(|p| policy_name(*p))
                        .collect::<Vec<_>>()
                        .join(", ")
                );
            }
        }
        expand_selection(&selected, policy, join_group, headers, &params)?
    };
    require_reference_dates(&plan.0, headers)?;
    Ok(plan)
}

pub(crate) fn expand_selection(
    selected: &[Selected],
    policy: Policy,
    join_group: Option<&str>,
    headers: &csv::StringRecord,
    params: &GenParams,
) -> Result<ColumnPlan> {
    let mut policies = vec![Policy::Keep; headers.len()];
    let mut groups = vec![None; headers.len()];
    let mut types = vec![CanonType::Auto; headers.len()];
    for sel in selected {
        let p = match sel.generalise {
            Some((p, w)) => params.fill(p, w, None)?,
            None => params.fill(policy, None, None)?,
        };
        policies[sel.idx] = p;
        types[sel.idx] = sel.canon;
        if p.key_material() == KeyMaterial::ColumnKey {
            groups[sel.idx] = join_group.map(String::from);
        }
    }
    Ok((policies, groups, types))
}
