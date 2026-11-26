use crate::mapping_file::MappingStore;
use crate::session;
use anonymiser_core::{derive_root_key_raw, mapping_key, open_mapping_value};
use anyhow::{anyhow, Context, Result};
use clap::Parser;
use std::io::Read;
use std::path::PathBuf;
use zeroize::Zeroizing;

#[derive(Parser, Debug)]
pub struct DepseudoArgs {
    /// Mapping sidecar written by `anonymise --reversible`
    /// (default path: `<dataset>.mapping`).
    mapping_file: PathBuf,
    /// Tokens to reverse; reads one per line from stdin when none are given.
    tokens: Vec<String>,
    /// Master-key file used by the anonymise run (versioned envelope).
    #[arg(long, default_value = "master_key.bin")]
    master_key_file: PathBuf,
    /// Accept a pre-v1 raw (≥32-byte) key file, with a warning.
    #[arg(long)]
    allow_legacy_key: bool,
    /// File salt used by the anonymise run.
    #[arg(long, default_value = "anonymiser.salt")]
    salt_file: PathBuf,
}

pub fn run(args: DepseudoArgs) -> Result<()> {
    let store = MappingStore::open_for_read(&args.mapping_file)?;
    let salt = Zeroizing::new(crate::salt_file::read_salt_file(&args.salt_file)?);
    let salt_id = anonymiser_core::key_fingerprint(&salt);
    if store.salt_id != salt_id {
        anyhow::bail!(
            "salt file {:?} does not match the mapping header's salt id {}",
            args.salt_file,
            store.salt_id
        );
    }

    let master_key = session::read_master_key(&args.master_key_file, args.allow_legacy_key)?;
    let root = derive_root_key_raw(&master_key, &salt);
    let key = Zeroizing::new(mapping_key(&root, &store.dataset));

    let tokens: Vec<String> = if !args.tokens.is_empty() {
        args.tokens.clone()
    } else {
        let mut buf = String::new();
        std::io::stdin()
            .lock()
            .read_to_string(&mut buf)
            .context("read tokens from stdin")?;
        buf.lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect()
    };
    if tokens.is_empty() {
        anyhow::bail!("no tokens given: pass them as arguments or on stdin (one per line)");
    }

    let mut missing = 0usize;
    for token in &tokens {
        match store.get(token) {
            Some(row) => {
                let nonce_vec = hex_compat(&row.nonce, "nonce")?;
                let nonce: [u8; anonymiser_core::MAPPING_NONCE_LEN] = nonce_vec
                    .try_into()
                    .map_err(|_| anyhow!("mapping row nonce is not 24 bytes — corrupt row"))?;
                let ct = hex_compat(&row.ct, "ciphertext")?;
                let value =
                    open_mapping_value(&key, &store.dataset, &row.group, token, &nonce, &ct)
                        .map_err(|e| {
                            anyhow!(
                                "{:?}: row failed authentication ({e}) — wrong key or tampered row",
                                token
                            )
                        })?;
                println!("{token}\t{value}");
            }
            None => {
                eprintln!("token {token} not in {:?}", args.mapping_file);
                missing += 1;
            }
        }
    }
    if missing > 0 {
        anyhow::bail!("{missing} of {} tokens were not found", tokens.len());
    }
    Ok(())
}

fn hex_compat(s: &str, what: &str) -> Result<Vec<u8>> {
    hex::decode(s).with_context(|| format!("decode {what} hex in mapping row"))
}
