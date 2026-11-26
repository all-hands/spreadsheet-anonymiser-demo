use crate::args::{PolicyArg, TokenEncodingArg};
use crate::io::{self, Format};
use crate::pii::{looks_like_email, looks_like_phone};
use crate::plan::{build_column_plan, INSPECT_POLICIES};
use crate::policy_file::{parse_reference_date, policy_name, GenParams};
use crate::session;
use anonymiser_core::{derive_root_key_raw, CanonType, Policy};
use anyhow::{anyhow, Context, Result};
use clap::Parser;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use zeroize::Zeroizing;

#[derive(Parser, Debug)]
pub struct InspectArgs {
    infile: PathBuf,
    /// Columns to pseudonymise: comma-separated header names or indices.
    #[arg(long, conflicts_with = "policy_file")]
    columns: Option<String>,
    /// Policy applied to the selected columns (dry-run plan only).
    #[arg(long, default_value = "hash", conflicts_with = "policy_file")]
    policy: PolicyArg,
    /// Per-column policy file (same format the web app exports).
    #[arg(long)]
    policy_file: Option<PathBuf>,
    /// Date `age-band` columns compute ages on, yyyy-mm-dd (as `anonymise`).
    #[arg(long, value_name = "YYYY-MM-DD")]
    reference_date: Option<String>,
    /// Default band/bucket width for age-band and bucket columns.
    #[arg(long, value_name = "N")]
    width: Option<u32>,
    /// Inspect every column.
    #[arg(long, conflicts_with = "columns", conflicts_with = "policy_file")]
    all_columns: bool,
    /// One shared token namespace for all anonymised columns.
    #[arg(long, requires = "columns")]
    join_group: Option<String>,
    /// Dataset namespace for column keys.
    #[arg(long, value_parser = crate::args::non_empty_dataset)]
    dataset: Option<String>,
    /// Keyed-hash token length in bytes — inspected for the
    /// collision bound, and used for the sample tokens.
    #[arg(long, default_value_t = anonymiser_core::DEFAULT_TOKEN_BYTES)]
    token_bytes: usize,
    /// Token alphabet for the sample tokens.
    #[arg(long, value_enum, default_value = "hex")]
    token_encoding: TokenEncodingArg,
    /// Input format: csv (default), tsv or jsonl; inferred
    /// from the file extension when omitted. `-` reads stdin.
    #[arg(long, value_enum)]
    format: Option<Format>,
    /// Master-key file for sample tokens. Read-only: if missing or invalid
    /// the sample section is skipped, never auto-created.
    #[arg(long)]
    master_key_file: Option<PathBuf>,
    /// Salt file for sample tokens. Read-only, like the key.
    #[arg(long)]
    salt_file: Option<PathBuf>,
}

fn collision_bound(bytes: usize) -> f64 {
    2f64.powi(((8 * bytes + 1) as i32) / 2) * 1e-9f64.sqrt()
}

pub fn run(args: InspectArgs) -> Result<()> {
    crate::plan::refuse_deprecated(
        args.policy.into(),
        &args.columns,
        args.policy_file.as_deref(),
    )?;
    let format = io::resolve_format(args.format, &[&args.infile]);
    let mut rdr = io::TableReader::open(&args.infile, format)?;
    let headers = rdr.headers().clone();

    let (policies, groups, types) = build_column_plan(
        &crate::plan::ColumnPlanFlags {
            columns: &args.columns,
            policy: args.policy.into(),
            join_group: args.join_group.as_deref(),
            all_columns: args.all_columns,
            policy_file: args.policy_file.as_deref(),
            params: GenParams {
                width: args.width,
                reference: args
                    .reference_date
                    .as_deref()
                    .map(parse_reference_date)
                    .transpose()?,
            },
            select_all: false,
        },
        &headers,
        Some(INSPECT_POLICIES),
    )?;

    let ncols = headers.len();
    let mut distinct: Vec<HashSet<String>> = vec![HashSet::new(); ncols];
    let mut blanks = vec![0usize; ncols];
    let kept_idx: Vec<usize> = (0..ncols)
        .filter(|&i| policies[i] == Policy::Keep)
        .collect();
    let qi_idx: Vec<usize> = (0..ncols)
        .filter(|&i| policies[i] == Policy::Keep || policies[i].is_generalisation())
        .collect();
    let mut measurer = (!qi_idx.is_empty())
        .then(|| anonymiser_core::Measurer::new(&qi_idx))
        .transpose()?;
    let mut email_hits = vec![0usize; ncols];
    let mut phone_hits = vec![0usize; ncols];
    let mut sample_value: Vec<Option<String>> = vec![None; ncols];
    let mut rows = 0usize;

    while let Some(record) = rdr.next_record()? {
        rows += 1;
        for (i, val) in record.iter().enumerate() {
            distinct[i].insert(val.to_string());
            let blank = val.trim().is_empty();
            if blank {
                blanks[i] += 1;
            } else if sample_value[i].is_none() && policies[i] == Policy::Hash {
                sample_value[i] = Some(val.to_string());
            }
            if policies[i] == Policy::Keep {
                if looks_like_email(val) {
                    email_hits[i] += 1;
                } else if looks_like_phone(val) {
                    phone_hits[i] += 1;
                }
            }
        }
        let key = qi_idx
            .iter()
            .map(|&i| {
                let v = record.get(i).unwrap_or_default();
                if policies[i].is_generalisation() {
                    anonymiser_core::apply_typed(v, policies[i], None, 0, CanonType::Auto)
                        .map_err(|e| anyhow!("row {rows}: {e}"))
                } else {
                    Ok(v.to_string())
                }
            })
            .collect::<Result<Vec<_>>>()?;
        if let Some(m) = measurer.as_mut() {
            m.add(&key)?;
        }
    }

    println!(
        "Inspecting {:?} — {} rows, {} columns",
        args.infile, rows, ncols
    );
    println!(
        "{:<4} {:<24} {:<14} {:<9} {:<9} NOTES",
        "#", "COLUMN", "ACTION", "DISTINCT", "BLANK"
    );
    let bound = collision_bound(args.token_bytes);
    for i in 0..ncols {
        let mut notes: Vec<String> = Vec::new();
        let n = distinct[i].len();
        if rows > 0 && blanks[i] == rows {
            notes.push("⚠ entirely blank — empty cells pass through".to_string());
        } else if blanks[i] > 0 {
            notes.push(format!("⚠ {}/{} blank cells pass through", blanks[i], rows));
        }
        if policies[i].key_material() == anonymiser_core::KeyMaterial::ColumnKey
            && n as f64 > bound / 100.0
        {
            notes.push(format!(
                "⚠ cardinality {n} approaches the ~{:.0e} collision bound for \
                 {}-byte tokens — raise --token-bytes",
                bound, args.token_bytes
            ));
        }
        let group = groups[i]
            .as_ref()
            .map(|g| format!("~{g}"))
            .unwrap_or_default();
        let ty = if types[i] == anonymiser_core::CanonType::Auto {
            String::new()
        } else {
            format!(":{}", crate::policy_file::canon_type_name(types[i]))
        };
        println!(
            "{:<4} {:<24} {:<14} {:<9} {:<9} {}",
            i,
            headers.get(i).unwrap_or("?"),
            format!("{}{ty}{group}", policy_name(policies[i])),
            if rows > 0 {
                n.to_string()
            } else {
                "—".to_string()
            },
            if blanks[i] > 0 {
                blanks[i].to_string()
            } else {
                "—".to_string()
            },
            notes.join("; ")
        );
    }

    let kept_names = |hits: &Vec<usize>| -> String {
        kept_idx
            .iter()
            .filter(|&&i| hits[i] > 0)
            .map(|&i| format!("{} ({})", headers.get(i).unwrap_or("?"), hits[i]))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let emails = kept_names(&email_hits);
    let phones = kept_names(&phone_hits);
    if emails.is_empty() && phones.is_empty() {
        println!("Advisory PII scan on kept columns: none matched email/phone patterns.");
    } else {
        if !emails.is_empty() {
            println!("⚠ kept columns with email-like values: {emails}");
        }
        if !phones.is_empty() {
            println!("⚠ kept columns with phone-like values: {phones}");
        }
    }

    if qi_idx.is_empty() {
        println!("k-anonymity: no columns kept in clear or generalised — nothing to measure.");
    } else if rows == 0 {
        println!("k-anonymity: file has no data rows.");
    } else {
        let report = measurer
            .as_ref()
            .expect("measurer exists when qi_idx is non-empty")
            .report(anonymiser_core::MIN_K)?;
        let k1 = report.rows_below_k;
        let names = qi_idx
            .iter()
            .map(|&i| {
                let h = headers.get(i).unwrap_or("?");
                if policies[i].is_generalisation() {
                    format!("{h} [{}]", policy_name(policies[i]))
                } else {
                    h.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join(", ");
        let pct = 100.0 * k1 as f64 / rows as f64;
        println!(
            "k-anonymity of kept and generalised columns ({names}): min k={}, k=1 for {k1}/{rows} rows ({pct:.0}%).",
            report.min_group
        );
        if k1 > 0 {
            println!(
                "  ⚠ those rows are uniquely identifiable from the kept and generalised columns \
                 alone — consider dropping or bucketing quasi-identifiers before sharing."
            );
        }
    }

    let key_path = args.master_key_file.as_ref().filter(|p| p.exists());
    let salt_path = args.salt_file.as_ref().filter(|p| p.exists());
    match (key_path, salt_path) {
        (Some(kp), Some(sp)) => 'sample: {
            let loaded = (|| -> Result<_> {
                let key_bytes = fs::read(kp).with_context(|| format!("read key {kp:?}"))?;
                let parsed = anonymiser_core::parse_master_key(&key_bytes)
                    .map_err(|e| anyhow!("{kp:?}: {e}"))?;
                let key = Zeroizing::new(parsed.key);
                let salt = Zeroizing::new(crate::salt_file::read_salt_file(sp)?);
                Ok((key, salt))
            })();
            let (key, salt) = match loaded {
                Ok(v) => v,
                Err(e) => {
                    println!("Sample tokens skipped: {e:#}");
                    break 'sample;
                }
            };
            let root = derive_root_key_raw(&key, &salt);
            let mut shown = 0;
            for i in 0..ncols {
                if shown == 3 {
                    break;
                }
                if policies[i] != Policy::Hash {
                    continue;
                }
                let Some(value) = &sample_value[i] else {
                    continue;
                };
                let name = groups[i]
                    .as_deref()
                    .unwrap_or(headers.get(i).unwrap_or("?"));
                let col_key =
                    session::derive_column_key(&root, &salt, args.dataset.as_deref(), name)?;
                let enc: anonymiser_core::TokenEncoding = args.token_encoding.into();
                let token = anonymiser_core::reencode_token(
                    &anonymiser_core::apply_typed(
                        value,
                        Policy::Hash,
                        Some(&col_key),
                        args.token_bytes,
                        types[i],
                    )?,
                    Policy::Hash,
                    enc,
                );
                println!(
                    "Sample: {} → {token} ({} {} chars)",
                    headers.get(i).unwrap_or("?"),
                    token.len(),
                    enc
                );
                shown += 1;
            }
            if shown == 0 {
                println!("Sample tokens: no hash-policy column with data.");
            }
        }
        _ => {
            if args.master_key_file.is_some() || args.salt_file.is_some() {
                println!(
                    "Sample tokens: skipped — need both an existing key file and salt file \
                     (inspect never creates them)."
                );
            }
        }
    }
    println!("Inspect wrote nothing — dry-run only.");
    Ok(())
}
