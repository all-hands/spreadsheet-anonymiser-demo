use crate::policy_file::{canon_type_name, policy_name};
use crate::salt_file::{salt_id, Kdf, SaltOrigin};
use anonymiser_core::{key_fingerprint, CanonType, Policy, TokenEncoding};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

pub(crate) const MANIFEST_KIND: &str = "anonymiser-manifest";
pub(crate) const MANIFEST_SCHEMA: u32 = 1;

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub(crate) struct Manifest {
    pub kind: String,
    pub schema_version: u32,
    pub tool_version: String,
    pub created_utc: String,
    pub dataset: Option<String>,
    pub oneshot: bool,
    pub reversible: bool,
    pub salt: SaltRecord,
    pub key_schedule: KeyScheduleRecord,
    pub tokens: TokensRecord,
    pub columns: Vec<ColumnRecord>,
    pub input: InputRecord,
    pub output: OutputRecord,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suppression: Option<SuppressionRecord>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
pub(crate) struct SuppressionRecord {
    pub quasi_identifiers: Vec<usize>,
    pub min_group: usize,
    pub mode: String,
    pub rows_suppressed: usize,
    pub cells_suppressed: usize,
    pub rows_dropped: usize,
    pub min_group_before: usize,
    pub min_group_after: usize,
}

impl SuppressionRecord {
    pub(crate) fn new(qi: &[usize], s: &anonymiser_core::Suppression) -> Self {
        SuppressionRecord {
            quasi_identifiers: qi.to_vec(),
            min_group: s.k,
            mode: s.mode.as_str().to_string(),
            rows_suppressed: s.rows_suppressed,
            cells_suppressed: s.cells_suppressed,
            rows_dropped: s.rows_dropped,
            min_group_before: s.min_group_before,
            min_group_after: s.min_group_after,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub(crate) struct SaltRecord {
    pub id: Option<String>,
    pub format: String,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub(crate) struct KeyScheduleRecord {
    pub kdf: String,
    pub argon2id: Option<Argon2Record>,
    pub key_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub(crate) struct Argon2Record {
    pub iters: u32,
    pub memory_kb: u32,
    pub threads: u32,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub(crate) struct TokensRecord {
    pub encoding: String,
    pub bytes: usize,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub(crate) struct ColumnRecord {
    pub index: usize,
    pub name: String,
    pub policy: String,
    pub canon: String,
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference_date: Option<String>,
}

fn gen_params(p: Policy) -> (Option<u32>, Option<String>) {
    match p {
        Policy::AgeBand { width, reference } => (Some(width), reference.map(|d| d.to_string())),
        Policy::Bucket { width } => (Some(width), None),
        _ => (None, None),
    }
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub(crate) struct InputRecord {
    pub name: String,
    pub sha256: Option<String>,
    pub rows: usize,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub(crate) struct OutputRecord {
    pub name: String,
    pub sha256: String,
    pub rows: usize,
}

pub(crate) struct RunFacts<'a> {
    pub infile: &'a Path,
    pub outfile: &'a Path,
    pub rows: usize,
    pub rows_out: usize,
    pub suppression: Option<SuppressionRecord>,
    pub dataset: Option<&'a str>,
    pub oneshot: bool,
    pub reversible: bool,
    pub kdf: Kdf,
    pub salt_origin: SaltOrigin,
    pub file_salt: &'a [u8],
    pub master_key: Option<&'a [u8]>,
    pub enc: TokenEncoding,
    pub token_bytes: usize,
    pub headers: &'a csv::StringRecord,
    pub policies: &'a [Policy],
    pub file_groups: &'a [Option<String>],
    pub canon_types: &'a [CanonType],
}

pub(crate) fn path_for(output: &Path) -> PathBuf {
    PathBuf::from(format!("{}.manifest.json", output.display()))
}

fn file_name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| p.display().to_string())
}

pub(crate) fn sha256_file(path: &Path) -> Result<String> {
    let mut f = File::open(path).with_context(|| format!("hash {path:?}"))?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).with_context(|| format!("hash {path:?}"))?;
        if n == 0 {
            return Ok(hex::encode(h.finalize()));
        }
        h.update(&buf[..n]);
    }
}

fn utc_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format_utc(secs)
}

fn format_utc(secs: u64) -> String {
    let (days, rem) = ((secs / 86_400) as i64, secs % 86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

pub(crate) fn build(f: &RunFacts<'_>) -> Result<Manifest> {
    let stdin = f.infile.as_os_str() == "-";
    Ok(Manifest {
        kind: MANIFEST_KIND.to_string(),
        schema_version: MANIFEST_SCHEMA,
        tool_version: env!("CARGO_PKG_VERSION").to_string(),
        created_utc: utc_now(),
        dataset: f.dataset.map(str::to_string),
        oneshot: f.oneshot,
        reversible: f.reversible,
        salt: SaltRecord {
            id: (!f.oneshot).then(|| salt_id(f.file_salt)),
            format: f.salt_origin.as_str().to_string(),
        },
        key_schedule: KeyScheduleRecord {
            kdf: f.kdf.id().to_string(),
            argon2id: match f.kdf {
                Kdf::Argon2id(p) => Some(Argon2Record {
                    iters: p.iters,
                    memory_kb: p.memory_kb,
                    threads: p.threads,
                }),
                Kdf::HkdfRaw => None,
            },
            key_id: f.master_key.map(key_fingerprint),
        },
        tokens: TokensRecord {
            encoding: f.enc.to_string(),
            bytes: f.token_bytes,
        },
        columns: f
            .headers
            .iter()
            .enumerate()
            .map(|(i, name)| {
                let (width, reference_date) = gen_params(f.policies[i]);
                ColumnRecord {
                    index: i,
                    name: name.to_string(),
                    policy: policy_name(f.policies[i]).to_string(),
                    canon: canon_type_name(f.canon_types[i]).to_string(),
                    group: f.file_groups[i].clone(),
                    width,
                    reference_date,
                }
            })
            .collect(),
        input: InputRecord {
            name: file_name(f.infile),
            sha256: if stdin {
                None
            } else {
                Some(sha256_file(f.infile)?)
            },
            rows: f.rows,
        },
        output: OutputRecord {
            name: file_name(f.outfile),
            sha256: sha256_file(f.outfile)?,
            rows: f.rows_out,
        },
        suppression: f.suppression.clone(),
    })
}

pub(crate) fn write(m: &Manifest, output: &Path) -> Result<PathBuf> {
    let dest = path_for(output);
    let tmp = PathBuf::from(format!("{}.part", dest.display()));
    let _ = fs::remove_file(&tmp);
    let mut json = serde_json::to_string_pretty(m)?;
    json.push('\n');
    crate::secret_file::write_new(&tmp, json.as_bytes())
        .with_context(|| format!("create {tmp:?}"))?;
    if let Err(e) = fs::rename(&tmp, &dest) {
        let _ = fs::remove_file(&tmp);
        return Err(e).with_context(|| format!("move {tmp:?} -> {dest:?}"));
    }
    Ok(dest)
}

pub(crate) fn record_run(f: &RunFacts<'_>) -> Result<PathBuf> {
    write(&build(f)?, f.outfile)
}

pub(crate) fn read(path: &Path) -> Result<Manifest> {
    let raw = fs::read_to_string(path).with_context(|| format!("read manifest {path:?}"))?;
    let m: Manifest =
        serde_json::from_str(&raw).with_context(|| format!("parse manifest {path:?}"))?;
    if m.kind != MANIFEST_KIND {
        bail!("{path:?} is not an anonymiser manifest");
    }
    if m.schema_version > MANIFEST_SCHEMA {
        bail!(
            "manifest {path:?} schema_version {} is newer than this tool supports ({MANIFEST_SCHEMA})",
            m.schema_version
        );
    }
    Ok(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utc_formatting_known_instants() {
        assert_eq!(format_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(format_utc(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(format_utc(1_794_318_245), "2026-11-10T13:44:05Z");
    }

    #[test]
    fn sha256_known_vector() {
        let d =
            std::env::temp_dir().join(format!("anonymiser-cli-manifest-{}", std::process::id()));
        fs::create_dir_all(&d).expect("dir");
        let p = d.join("abc.txt");
        fs::write(&p, b"abc").expect("write");
        assert_eq!(
            sha256_file(&p).expect("hash"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let _ = fs::remove_dir_all(&d);
    }
}
