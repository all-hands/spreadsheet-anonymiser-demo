use crate::args::AnonymiseArgs;
use crate::io::{resolve_format, Output, TableReader, TableWriter};
use crate::manifest;
use crate::mapping_file::MappingStore;
use crate::plan::build_column_plan;
use crate::policy_file::{
    canon_type_name, parse_reference_date, policy_label, ColumnPlan, GenParams,
};
use crate::session::{self, Session};
use anonymiser_core::{
    apply_typed, canonicalize_typed, key_fingerprint, mapping_key, reencode_token, Policy,
    TokenEncoding,
};
use anyhow::{anyhow, Result};
use zeroize::Zeroizing;

pub fn run(mut args: AnonymiseArgs, matches: &clap::ArgMatches) -> Result<()> {
    if let Some(path) = args.profile.take() {
        crate::profile::apply_profile(&mut args, matches, &path)?;
        crate::profile::validate_merged(&args)?;
    }
    if !args.decrypt {
        crate::plan::refuse_deprecated(
            args.policy.into(),
            &args.columns,
            args.policy_file.as_deref(),
        )?;
    }
    let Session {
        root,
        master_key: session_master_key,
        file_salt,
        kdf,
        salt_origin,
    } = session::bootstrap(&args)?;

    let to_stdout = args.outfile.as_os_str() == "-";
    if !to_stdout && args.outfile.exists() && !args.force {
        anyhow::bail!(
            "output {:?} already exists; pass --force to overwrite",
            args.outfile
        );
    }
    let format = resolve_format(args.format, &[&args.infile, &args.outfile]);
    let rdr = TableReader::open(&args.infile, format)?;
    let headers = rdr.headers().clone();
    // INVARIANT: output is atomic. A ragged row or write error must never
    // leave a truncated file at the destination path.
    let wtr = TableWriter::create(Output::from_path(&args.outfile), format, &headers)?;

    let (policies, file_groups, canon_types): ColumnPlan = build_column_plan(
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
            select_all: args.decrypt,
        },
        &headers,
        None,
    )?;
    if !args.decrypt {
        for p in &policies {
            p.for_new_run().map_err(|e| anyhow!("{e}"))?;
        }
    }

    let suppression = resolve_suppression(&args, &headers)?;

    let dataset = args.dataset.as_deref();

    let legacy_key: Option<&[u8]> = args.legacy_key.as_deref().map(str::as_bytes);
    if policies
        .iter()
        .any(|p| p.key_material() == anonymiser_core::KeyMaterial::Passphrase)
        && legacy_key.is_none()
    {
        return Err(anyhow!(
            "legacy-* policies require --legacy-key (the old app's global key)"
        ));
    }
    let col_keys = session::derive_column_keys(
        &root,
        &file_salt,
        dataset,
        args.decrypt,
        &policies,
        &headers,
        &file_groups,
    )?;

    let mut mapping: Option<(
        MappingStore,
        Zeroizing<[u8; anonymiser_core::MAPPING_KEY_LEN]>,
    )> = None;
    if args.reversible {
        let ds = dataset.unwrap_or_default();
        if !policies
            .iter()
            .zip(col_keys.iter())
            .any(|(p, k)| *p == Policy::Hash && k.is_some())
        {
            anyhow::bail!(
                "--reversible needs hash-policy columns (encrypt cells already \
                 reverse via --decrypt; redact/mask/faux are not invertible)"
            );
        }
        let path = args
            .mapping_file
            .clone()
            .unwrap_or_else(|| std::path::PathBuf::from(format!("{ds}.mapping")));
        let salt_id = crate::salt_file::salt_id(&file_salt);
        let store = MappingStore::open_for_append(&path, ds, &salt_id)?;
        let mkey = Zeroizing::new(mapping_key(&root, ds));
        mapping = Some((store, mkey));
    }

    let engine = RowEngine {
        rdr,
        wtr,
        decrypt: args.decrypt,
        token_bytes: args.token_bytes,
        enc: args.token_encoding.into(),
        policies: &policies,
        canon_types: &canon_types,
        col_keys: &col_keys,
        legacy_key,
        file_groups: &file_groups,
        headers: &headers,
        dataset,
        mapping: &mut mapping,
        suppression: suppression.as_ref(),
    };
    let (rows, suppressed, measured) = engine.stream_rows()?;
    let rows_out = rows - suppressed.as_ref().map_or(0, |s| s.rows_dropped);

    let manifest_path = if args.no_manifest || to_stdout || args.decrypt {
        None
    } else {
        Some(manifest::record_run(&manifest::RunFacts {
            infile: &args.infile,
            outfile: &args.outfile,
            rows,
            rows_out,
            suppression: suppression
                .as_ref()
                .zip(suppressed.as_ref())
                .map(|(plan, s)| manifest::SuppressionRecord::new(&plan.qi, s)),
            dataset,
            oneshot: args.oneshot,
            reversible: args.reversible,
            kdf,
            salt_origin,
            file_salt: &file_salt,
            master_key: session_master_key.as_ref().map(|k| &k[..]),
            enc: args.token_encoding.into(),
            token_bytes: args.token_bytes,
            headers: &headers,
            policies: &policies,
            file_groups: &file_groups,
            canon_types: &canon_types,
        })?)
    };

    println!(
        "Wrote {} {}: {:?} ({} rows)",
        if args.decrypt {
            "decrypted"
        } else {
            "anonymised"
        },
        format.name(),
        args.outfile,
        rows_out
    );
    if !args.decrypt {
        println!(
            "Notice: output is pseudonymised, not anonymous. \
             Treat it as personal data under GDPR."
        );
    }
    if !args.decrypt {
        let plan = headers
            .iter()
            .zip(&policies)
            .zip(&file_groups)
            .zip(&canon_types)
            .enumerate()
            .map(|(i, (((h, p), g), ty))| {
                let ty = if *ty == anonymiser_core::CanonType::Auto {
                    String::new()
                } else {
                    format!(":{}", canon_type_name(*ty))
                };
                format!(
                    "{i}:{h}={}{}{}",
                    policy_label(*p),
                    ty,
                    g.as_ref().map(|g| format!("~{g}")).unwrap_or_default()
                )
            })
            .collect::<Vec<_>>()
            .join(" ");
        println!("Columns: {plan}");
    }
    if let (Some(plan), Some(s)) = (suppression.as_ref(), suppressed.as_ref()) {
        let names: Vec<&str> = plan.qi.iter().map(|&i| &headers[i]).collect();
        println!(
            "Suppression: {} on quasi-identifiers [{}], min group {}: {} of {} rows in smaller \
             groups, {}.",
            s.mode.as_str(),
            names.join(", "),
            s.k,
            s.rows_suppressed,
            s.rows_in,
            match s.mode {
                anonymiser_core::SuppressMode::Cells => format!(
                    "{} cells replaced with {}",
                    s.cells_suppressed,
                    anonymiser_core::SUPPRESSED
                ),
                anonymiser_core::SuppressMode::Rows => format!("{} rows dropped", s.rows_dropped),
            }
        );
        if let Some(report) = measured.as_ref() {
            println!("{}", report.claim(&names));
        }
        println!(
            "Smallest remaining group {} (was {}).",
            s.min_group_after, s.min_group_before
        );
    }
    if let Some(ds) = dataset {
        println!("Dataset namespace: {ds:?} (keys are domain-separated from dataset-less runs)");
    }
    if let Some(key) = session_master_key.as_ref() {
        println!(
            "Key fingerprint: {} (first 8 bytes of BLAKE2b-512 of the master key)",
            key_fingerprint(key)
        );
        println!("Key schedule: HKDF-SHA512 (raw master key — no KDF stretch; same key + salt reproduces tokens)");
        println!(
            "Master key (path): {:?} - protect this file!",
            args.master_key_file
        );
    } else {
        println!("Key schedule: Argon2id(passphrase) — browser parity; same passphrase + salt reproduces tokens");
        println!("KDF: {kdf} — recorded with the salt and in the manifest");
    }
    if let Some(p) = &manifest_path {
        println!("Manifest: {p:?} (settings + SHA-256s; no secrets or data values)");
    }
    if args.oneshot {
        println!(
            "Salt: one-shot (ephemeral, never persisted) — this output \
             cannot be reproduced or joined by design"
        );
    } else {
        println!(
            "File salt (path): {:?} - publish alongside output for reproducibility",
            args.salt_file
        );
    }
    if let Some((store, _)) = mapping.as_ref() {
        println!(
            "Mapping sidecar: {:?} ({} sealed token(s), append-only, 0600) — \
             THIS FILE INVERTS THE PSEUDONYMISATION; keep it under key custody",
            store.path(),
            store.len()
        );
    }

    Ok(())
}

struct SuppressionPlan {
    qi: Vec<usize>,
    k: usize,
    mode: anonymiser_core::SuppressMode,
}

fn resolve_suppression(
    args: &AnonymiseArgs,
    headers: &csv::StringRecord,
) -> Result<Option<SuppressionPlan>> {
    let (Some(spec), Some(k)) = (args.quasi_identifiers.as_deref(), args.min_group) else {
        if args.quasi_identifiers.is_some() || args.min_group.is_some() || args.suppress.is_some() {
            anyhow::bail!("--quasi-identifiers, --min-group and --suppress go together");
        }
        return Ok(None);
    };
    if args.decrypt || args.reversible {
        anyhow::bail!(
            "suppression cannot be combined with --decrypt or --reversible (a mapping sidecar \
             would invert the suppressed rows)"
        );
    }
    if k < anonymiser_core::MIN_K {
        anyhow::bail!("{}", anonymiser_core::AnonymityError::KTooSmall);
    }
    Ok(Some(SuppressionPlan {
        qi: crate::plan::resolve_quasi_identifiers(spec, headers)?,
        k,
        mode: args
            .suppress
            .map_or(anonymiser_core::SuppressMode::Cells, Into::into),
    }))
}

struct RowEngine<'a> {
    rdr: TableReader,
    wtr: TableWriter,
    decrypt: bool,
    token_bytes: usize,
    enc: TokenEncoding,
    policies: &'a [Policy],
    canon_types: &'a [anonymiser_core::CanonType],
    col_keys: &'a Zeroizing<Vec<Option<[u8; 64]>>>,
    legacy_key: Option<&'a [u8]>,
    file_groups: &'a [Option<String>],
    headers: &'a csv::StringRecord,
    dataset: Option<&'a str>,
    mapping: &'a mut Option<(
        MappingStore,
        Zeroizing<[u8; anonymiser_core::MAPPING_KEY_LEN]>,
    )>,
    suppression: Option<&'a SuppressionPlan>,
}

impl RowEngine<'_> {
    fn stream_rows(
        mut self,
    ) -> Result<(
        usize,
        Option<anonymiser_core::Suppression>,
        Option<anonymiser_core::Report>,
    )> {
        let mut rows = 0usize;
        let mut buffered: Vec<Vec<String>> = Vec::new();
        while let Some(record) = self.rdr.next_record()? {
            let out_row: Vec<String> = if self.decrypt {
                record
                    .iter()
                    .enumerate()
                    .map(|(i, val)| decrypt_cell_cli(val, i, self.col_keys, self.legacy_key))
                    .collect::<Result<Vec<_>, _>>()?
            } else {
                record
                    .iter()
                    .enumerate()
                    .map(|(i, val)| {
                        let key: Option<&[u8]> = match self.policies[i].key_material() {
                            anonymiser_core::KeyMaterial::ColumnKey => {
                                self.col_keys[i].as_ref().map(|k| &k[..])
                            }
                            anonymiser_core::KeyMaterial::Passphrase => self.legacy_key,
                            anonymiser_core::KeyMaterial::None => None,
                        };
                        Ok::<String, anyhow::Error>(reencode_token(
                            &apply_typed(
                                val,
                                self.policies[i],
                                key,
                                self.token_bytes,
                                self.canon_types[i],
                            )
                            .map_err(|e| anyhow!("anonymise failed: {e}"))?,
                            self.policies[i],
                            self.enc,
                        ))
                    })
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| anyhow!("anonymise failed: {e}"))?
            };
            if let Some((store, mkey)) = self.mapping.as_mut() {
                let ds = self.dataset.unwrap_or_default();
                for (i, token) in out_row.iter().enumerate() {
                    if self.policies[i] != Policy::Hash || token.is_empty() {
                        continue;
                    }
                    if store.contains(token) {
                        continue;
                    }
                    let group = self.file_groups[i].as_deref().unwrap_or(&self.headers[i]);
                    let canonical =
                        canonicalize_typed(record.get(i).unwrap_or(""), self.canon_types[i]);
                    let (nonce, ct) =
                        anonymiser_core::seal_mapping_value(mkey, ds, group, token, &canonical)
                            .map_err(|e| anyhow!("seal mapping row: {e}"))?;
                    store
                        .append(crate::mapping_file::MappingRow {
                            token: token.clone(),
                            group: group.to_string(),
                            nonce: hex::encode(nonce),
                            ct: hex::encode(ct),
                        })
                        .map_err(|e| anyhow!("append mapping row: {e}"))?;
                }
            }
            if self.suppression.is_some() {
                buffered.push(out_row);
            } else {
                self.wtr.write_record(&csv::StringRecord::from(out_row))?;
            }
            rows += 1;
        }
        let mut outcome = None;
        let mut measured = None;
        if let Some(plan) = self.suppression {
            outcome = Some(
                anonymiser_core::suppress_small_groups(&mut buffered, &plan.qi, plan.k, plan.mode)
                    .map_err(|e| anyhow!("{e}"))?,
            );
            let informative: Vec<Vec<String>> = buffered
                .iter()
                .filter(|r| !plan.qi.iter().all(|&c| r[c] == anonymiser_core::SUPPRESSED))
                .cloned()
                .collect();
            measured = Some(
                anonymiser_core::measure_rows(&informative, &plan.qi, plan.k)
                    .map_err(|e| anyhow!("{e}"))?,
            );
            for row in buffered {
                self.wtr.write_record(&csv::StringRecord::from(row))?;
            }
        }
        self.wtr.finish()?;
        Ok((rows, outcome, measured))
    }
}

fn decrypt_cell_cli(
    val: &str,
    i: usize,
    col_keys: &[Option<[u8; 64]>],
    legacy_key: Option<&[u8]>,
) -> Result<String> {
    use anonymiser_core as core;

    let col_key = col_keys[i].as_ref().map(|k| &k[..]);
    core::decrypt_any(val, col_key, legacy_key).map_err(|e| match (&e, legacy_key) {
        (core::Error::MissingDecryptKey, None) => {
            anyhow!("decrypting old enc:/qenc: cells requires --legacy-key")
        }
        (core::Error::MissingDecryptKey, Some(_)) => {
            anyhow!("decrypt requires a keyed column")
        }
        (e, _) => anyhow!("decrypt failed: {e}"),
    })
}
