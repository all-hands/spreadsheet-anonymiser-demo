use crate::manifest_check::Check;
use crate::policy_file::{policy_label, ColumnPlan};
use anonymiser_core::{CanonType, Policy};

fn ok(ok: bool, pass: String, fail: String) -> Check {
    Check {
        ok,
        msg: if ok { pass } else { fail },
    }
}

pub(crate) fn describe(plan: &ColumnPlan, headers: &csv::StringRecord) -> Vec<Check> {
    let mut out = Vec::new();
    for (i, p) in plan
        .0
        .iter()
        .enumerate()
        .filter(|(_, p)| p.is_generalisation())
    {
        let name = headers.get(i).unwrap_or("?");
        let unresolved = matches!(
            p,
            Policy::AgeBand {
                reference: None,
                ..
            }
        );
        out.push(ok(
            !unresolved,
            format!(
                "column {name} — {}: generalised values, not tokens (re-computed with --against)",
                policy_label(*p)
            ),
            format!(
                "column {name} — age-band has no reference date in the manifest/policy file; \
                 it cannot be re-checked (re-run with --reference-date)"
            ),
        ));
    }
    out
}

pub(crate) fn recompute(
    plan: &ColumnPlan,
    headers: &csv::StringRecord,
    orig: &[csv::StringRecord],
    out: &[csv::StringRecord],
) -> anyhow::Result<Vec<Check>> {
    let mut checks = Vec::new();
    for (i, p) in plan
        .0
        .iter()
        .enumerate()
        .filter(|(_, p)| p.is_generalisation())
    {
        if matches!(
            p,
            Policy::AgeBand {
                reference: None,
                ..
            }
        ) {
            continue;
        }
        let name = headers.get(i).unwrap_or("?");
        let mut bad: Vec<String> = Vec::new();
        let mut count = 0usize;
        for (row, (o, got)) in orig.iter().zip(out).enumerate() {
            let expect = anonymiser_core::apply_typed(
                o.get(i).unwrap_or_default(),
                *p,
                None,
                0,
                CanonType::Auto,
            )?;
            let got = got.get(i).unwrap_or_default();
            count += 1;
            if expect != got && bad.len() < 5 {
                bad.push(format!("row {row}: expected {expect:?}, found {got:?}"));
            }
        }
        checks.push(ok(
            bad.is_empty(),
            format!(
                "re-computation: column {name} — {count} {} cells match the original",
                p.as_str()
            ),
            format!(
                "re-computation failed for column {name} ({}): {}",
                policy_label(*p),
                bad.join("; ")
            ),
        ));
    }
    Ok(checks)
}
