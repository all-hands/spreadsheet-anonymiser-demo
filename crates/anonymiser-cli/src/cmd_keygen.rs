use anyhow::{anyhow, bail, Context, Result};
use clap::Args;
use std::fs;
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

#[derive(Args, Debug)]
pub struct KeygenArgs {
    /// Output key file (default: the --upgrade-from path, i.e. in-place
    /// upgrade, or `master_key.bin` for a fresh key).
    #[arg(long)]
    out: Option<PathBuf>,
    /// Upgrade this legacy raw key file (exactly 64 bytes, no envelope) to the
    /// versioned format. Key bytes are kept, so every token derived from it
    /// is unchanged.
    #[arg(long)]
    upgrade_from: Option<PathBuf>,
    /// Replace an existing output file.
    #[arg(long)]
    force: bool,
}

pub fn run(args: KeygenArgs) -> Result<()> {
    let key: Zeroizing<Vec<u8>> = match &args.upgrade_from {
        Some(src) => {
            let bytes = fs::read(src).with_context(|| format!("read legacy key {src:?}"))?;
            if bytes.len() != anonymiser_core::MASTER_KEY_LEN {
                bail!(
                    "{src:?} cannot be upgraded: the envelope holds exactly {} key bytes, found {}. \
                     Keep using --allow-legacy-key with the raw file, or mint a fresh key with \
                     `anonymiser keygen` (new tokens). The file was not modified",
                    anonymiser_core::MASTER_KEY_LEN,
                    bytes.len()
                );
            }
            Zeroizing::new(bytes)
        }
        None => {
            let mut k = vec![0u8; anonymiser_core::MASTER_KEY_LEN];
            getrandom::fill(&mut k).expect("OS RNG");
            Zeroizing::new(k)
        }
    };

    let key_id = anonymiser_core::key_fingerprint(&key);
    let envelope = anonymiser_core::wrap_master_key(&key).map_err(|e| anyhow!("keygen: {e}"))?;

    let out = args
        .out
        .clone()
        .or_else(|| args.upgrade_from.clone())
        .unwrap_or_else(|| PathBuf::from("master_key.bin"));

    let in_place = args.upgrade_from.as_deref() == Some(out.as_path());
    if out.exists() && !in_place && !args.force {
        bail!("{out:?} already exists; pass --force to replace it");
    }

    write_key_file(&out, &envelope)?;
    if args.upgrade_from.is_some() {
        println!("Upgraded legacy key → versioned envelope {out:?} (key bytes unchanged)");
    } else {
        println!("Created master-key file {out:?}");
    }
    println!("Key id: {key_id}");
    println!("Mode: owner-only (0600 / protected owner DACL) — this file is the capability to re-identify; never ship it with outputs");
    Ok(())
}

/// SECURITY: write the key atomically with mode 0600 (temp file next to the
/// destination, then rename): an interrupted run must never leave a
/// half-written or world-readable key file.
fn write_key_file(out: &Path, envelope: &[u8]) -> Result<()> {
    let tmp = PathBuf::from(format!("{}.part", out.display()));
    let _ = fs::remove_file(&tmp);
    crate::secret_file::write_new(&tmp, envelope).with_context(|| format!("create {:?}", tmp))?;
    fs::rename(&tmp, out).with_context(|| format!("move {tmp:?} -> {:?}", out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_short_legacy_keys() {
        let args = KeygenArgs {
            out: None,
            upgrade_from: Some(PathBuf::from("/dev/null")),
            force: false,
        };
        assert!(run(args).is_err());
    }
}
