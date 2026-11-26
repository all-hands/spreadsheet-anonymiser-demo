use crate::manifest_check;
use crate::plan::{build_column_plan, resolve_columns, ColumnPlanFlags};
use crate::policy_file::ColumnPlan;
use crate::session;
use crate::verify_generalised;
use crate::verify_report::{emit, read_table, Severity};
use anonymiser_core::{derive_root_key_raw, Policy};
use anyhow::{bail, Context, Result};
use clap::Parser;
use std::fs;
use std::path::PathBuf;
use zeroize::Zeroizing;

#[derive(Parser, Debug)]
pub struct VerifyArgs {
    /// Pseudonymised output file to audit.
    outfile: PathBuf,
    /// Master-key file: its envelope key id is reported, and it participates
    /// in --against re-derivation.
    #[arg(long)]
    master_key_file: Option<PathBuf>,
    /// Salt file used by the run (required for --against re-derivation).
    #[arg(long)]
    salt_file: Option<PathBuf>,
    /// Token columns to audit. Without it, columns whose non-blank cells are
    /// all token-shaped are auto-detected.
    #[arg(long)]
    columns: Option<String>,
    /// One shared token namespace used by the run.
    #[arg(long, requires = "columns")]
    join_group: Option<String>,
    /// Per-column policy file the run used (same schema `anonymise
    /// --policy-file` takes): gives re-derivation the real per-column
    /// policies, keying groups and canon types instead of the flag-shaped
    /// hash-only, one-shared-group approximation.
    #[arg(long, conflicts_with = "columns")]
    policy_file: Option<PathBuf>,
    /// Dataset namespace used by the run.
    #[arg(long, value_parser = crate::args::non_empty_dataset)]
    dataset: Option<String>,
    /// Token length in bytes the run used; default 16, or
    /// the manifest's value with --manifest.
    #[arg(long)]
    token_bytes: Option<usize>,
    /// Token alphabet the run used; default hex,
    /// or the manifest's value with --manifest.
    #[arg(long, value_enum)]
    token_encoding: Option<crate::args::TokenEncodingArg>,
    /// The run's `<output>.manifest.json`: checks the output's
    /// SHA-256 and row count, the salt/key fingerprints (when --salt-file /
    /// --master-key-file are given) and that explicit settings agree with
    /// the run; dataset, token settings and the per-column plan are taken
    /// from it unless overridden (--policy-file/--columns win for the plan).
    #[arg(long)]
    manifest: Option<PathBuf>,
    /// Original CSV the output was produced from: re-derives every token
    /// column cell and diffs against the output. Requires --master-key-file
    /// and --salt-file.
    #[arg(long, requires = "master_key_file", requires = "salt_file")]
    against: Option<PathBuf>,
}

pub fn run(args: VerifyArgs) -> Result<()> {
    let mut failures = 0usize;
    let manifest = args
        .manifest
        .as_deref()
        .map(crate::manifest::read)
        .transpose()?;
    let (settings, mut checks) = manifest_check::resolve(
        manifest.as_ref(),
        args.dataset.as_deref(),
        args.token_bytes,
        args.token_encoding.map(Into::into),
    );
    let (enc, token_bytes, dataset) = (settings.enc, settings.token_bytes, settings.dataset);
    let token_len = enc.token_char_len(token_bytes);

    let key = match &args.master_key_file {
        Some(kp) => {
            let bytes = fs::read(kp).with_context(|| format!("read key {kp:?}"))?;
            match anonymiser_core::parse_master_key(&bytes) {
                Ok(parsed) => {
                    println!(
                        "{} key id {} (CSVANON envelope v1, {})",
                        Severity::Ok.mark(),
                        parsed.key_id,
                        kp.display()
                    );
                    Some(Zeroizing::new(parsed.key))
                }
                Err(e) => {
                    println!("{} {}: {e}", Severity::Fail.mark(), kp.display());
                    failures += 1;
                    None
                }
            }
        }
        None => {
            println!("⚠ no --master-key-file given — key identity not audited");
            None
        }
    };

    let (headers, rows) = read_table(&args.outfile)?;

    if let Some(m) = &manifest {
        let salt = args
            .salt_file
            .as_deref()
            .map(crate::salt_file::read_salt_file)
            .transpose()?;
        let key_bytes = key.as_ref().map(|k| &k[..]);
        let against = args.against.is_some();
        checks.extend(manifest_check::audit(
            m,
            &args.outfile,
            rows.len(),
            salt.as_deref(),
            key_bytes,
            against,
        ));
    }

    let plan: Option<ColumnPlan> = match &args.policy_file {
        Some(pf) => Some(build_column_plan(
            &ColumnPlanFlags {
                columns: &None,
                policy: Policy::Hash,
                params: Default::default(),
                join_group: None,
                all_columns: false,
                policy_file: Some(pf),
                select_all: false,
            },
            &headers,
            None,
        )?),
        None => match (&manifest, &args.columns) {
            (Some(m), None) => match manifest_check::plan(m, &headers) {
                Ok(p) => Some(p),
                Err(e) => {
                    checks.push(manifest_check::Check {
                        ok: false,
                        msg: e.to_string(),
                    });
                    None
                }
            },
            _ => None,
        },
    };
    if let Some(plan) = &plan {
        checks.extend(verify_generalised::describe(plan, &headers));
    }
    failures += emit(&checks);
    let token_cols: Vec<(usize, anonymiser_core::CanonType)> = match &plan {
        Some((policies, _, types)) => (0..headers.len())
            .filter(|&i| policies[i] == Policy::Hash)
            .map(|i| (i, types[i]))
            .collect(),
        None => match &args.columns {
            Some(_) => resolve_columns(&args.columns, &headers, false)?,
            None => (0..headers.len())
                .filter(|&i| {
                    rows.iter()
                        .any(|r| !r.get(i).is_some_and(|v| v.trim().is_empty()))
                        && rows.iter().all(|r| {
                            r.get(i).is_some_and(|v| {
                                v.trim().is_empty() || enc.valid_token_shape(v, token_bytes)
                            })
                        })
                })
                .map(|i| (i, anonymiser_core::CanonType::Auto))
                .collect(),
        },
    };

    if token_cols.is_empty() {
        println!(
            "{} no token-shaped columns detected ({}-{}, --token-bytes {}); \
             pass --columns to audit specific ones",
            Severity::Warn.mark(),
            token_len,
            enc,
            token_bytes
        );
    }
    for &(i, _ty) in &token_cols {
        let (n, bad) = rows.iter().fold((0usize, 0usize), |(n, bad), r| {
            let v = r.get(i).unwrap_or_default();
            if v.trim().is_empty() {
                (n, bad)
            } else if enc.valid_token_shape(v, token_bytes) {
                (n + 1, bad)
            } else {
                (n, bad + 1)
            }
        });
        if bad == 0 {
            println!(
                "{} column {} — {n} cells are {token_len}-{} tokens",
                Severity::Ok.mark(),
                headers.get(i).unwrap_or("?"),
                enc
            );
        } else {
            println!(
                "{} column {} — {bad}/{n} non-blank cells are NOT {token_len}-{} tokens",
                Severity::Fail.mark(),
                headers.get(i).unwrap_or("?"),
                enc
            );
            failures += 1;
        }
    }

    let kept: Vec<usize> = (0..headers.len())
        .filter(|&i| !token_cols.iter().any(|(t, _)| *t == i))
        .filter(|&i| !plan.as_ref().is_some_and(|p| p.0[i].is_generalisation()))
        .collect();
    let pii = crate::pii::scan_kept(&headers, &rows, &kept);
    if pii.is_empty() {
        println!(
            "{} {} kept column(s): none match email/phone patterns",
            Severity::Ok.mark(),
            kept.len()
        );
    } else {
        println!(
            "{} kept columns contain PII-shaped values:",
            Severity::Warn.mark()
        );
        for line in pii {
            println!("    {line}");
        }
    }

    if let Some(orig_path) = &args.against {
        let (key, salt_path) = (key.as_ref(), args.salt_file.as_ref().unwrap());
        let salt = Zeroizing::new(crate::salt_file::read_salt_file(salt_path)?);
        let Some(key) = key else {
            bail!("--against requires a valid master key")
        };

        let (oheaders, orows) = read_table(orig_path)?;
        if oheaders != headers {
            bail!(
                "headers differ between {orig_path:?} and the output — \
                 not the same table"
            );
        }
        if orows.len() != rows.len() {
            bail!(
                "row count differs: original {} vs output {}",
                orows.len(),
                rows.len()
            );
        }

        if let Some(plan) = &plan {
            failures += emit(&verify_generalised::recompute(
                plan, &headers, &orows, &rows,
            )?);
        }

        let root = derive_root_key_raw(key, &salt);
        let group_name = |i: usize| -> &str {
            if let Some((_, groups, _)) = &plan {
                if let Some(g) = groups[i].as_deref() {
                    return g;
                }
            }
            args.join_group
                .as_deref()
                .unwrap_or(headers.get(i).unwrap_or("?"))
        };
        let col_keys: Vec<[u8; 64]> = token_cols
            .iter()
            .map(|&(i, _)| {
                session::derive_column_key(&root, &salt, dataset.as_deref(), group_name(i))
            })
            .collect::<Result<Vec<_>>>()?;
        let mut checked = 0usize;
        let mut mismatches: Vec<String> = Vec::new();
        for (row_idx, (orig, out)) in orows.iter().zip(&rows).enumerate() {
            for (col_idx, &(i, ty)) in token_cols.iter().enumerate() {
                let col_key = col_keys[col_idx];
                let o = orig.get(i).unwrap_or_default();
                let got = out.get(i).unwrap_or_default();
                let expect = anonymiser_core::reencode_token(
                    &anonymiser_core::apply_typed(
                        o,
                        Policy::Hash,
                        Some(&col_key),
                        token_bytes,
                        ty,
                    )?,
                    Policy::Hash,
                    enc,
                );
                checked += 1;
                if expect != got && mismatches.len() < 5 {
                    mismatches.push(format!(
                        "row {row_idx}, column {}: expected {expect:?}, found {got:?}",
                        headers.get(i).unwrap_or("?")
                    ));
                }
            }
        }
        if mismatches.is_empty() {
            println!(
                "{} re-derivation: {checked} token cells match {orig_path:?} \
                 under this key + salt",
                Severity::Ok.mark()
            );
        } else {
            println!(
                "{} re-derivation failed against {orig_path:?} — wrong key, \
                 salt, dataset/group or a tampered output:",
                Severity::Fail.mark()
            );
            for m in &mismatches {
                println!("    {m}");
            }
            if args.policy_file.is_none() {
                println!(
                    "    note: without --policy-file this audit models one \
                     shared group and hash-only columns — pass the run's \
                     policy file if it used per-column groups or types"
                );
            }
            failures += 1;
        }
    }

    if failures == 0 {
        println!("verify: all checks passed");
        Ok(())
    } else {
        bail!("verify: {failures} check(s) failed")
    }
}
