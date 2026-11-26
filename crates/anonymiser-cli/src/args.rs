use crate::io::Format;
use anonymiser_core::{Policy, TokenEncoding};
use clap::{Parser, ValueEnum};
use std::path::PathBuf;
use std::str::FromStr;

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum PresetArg {
    /// 19 MiB, t=2 — matches the browser/wasm default.
    Browser,
    /// 64 MiB, t=3 — stronger, slower; native runs only.
    Cli,
}

impl From<PresetArg> for anonymiser_core::Profile {
    fn from(p: PresetArg) -> Self {
        match p {
            PresetArg::Browser => anonymiser_core::Profile::browser(),
            PresetArg::Cli => anonymiser_core::Profile::cli(),
        }
    }
}

#[derive(Parser, Debug)]
pub(crate) struct AnonymiseArgs {
    pub(crate) infile: PathBuf,
    pub(crate) outfile: PathBuf,
    /// Master-key file (versioned CSVANON envelope, created 0600 if
    /// missing). The default session source; ignored when --passphrase.
    #[arg(long, default_value = "master_key.bin")]
    pub(crate) master_key_file: PathBuf,
    /// Accept a pre-v1 raw (≥32-byte) key file, with a warning. Temporary
    /// migration path; upgrade via `keygen --upgrade-from`.
    #[arg(long)]
    pub(crate) allow_legacy_key: bool,
    /// Load the file salt from this path, creating it if missing. Reusing a
    /// salt (with the same key or passphrase) keeps pseudonyms reproducible
    /// and joinable across runs and files.
    #[arg(long, default_value = "anonymiser.salt", conflicts_with = "oneshot")]
    pub(crate) salt_file: PathBuf,
    /// Explicitly unlinkable run: a fresh random salt used
    /// once and never persisted — tokens from two --oneshot runs never
    /// join, by construction.
    #[arg(long)]
    pub(crate) oneshot: bool,
    /// Derive the session from a passphrase (browser parity): Argon2id, the
    /// same schedule the web app uses for its keyed sessions. Pair with the
    /// browser's exported *.salt to reproduce its tokens byte for byte.
    #[arg(long)]
    pub(crate) passphrase: Option<String>,
    /// Argon2 profile for --passphrase: browser (default) or cli (stronger).
    #[arg(long, value_enum, requires = "passphrase")]
    pub(crate) preset: Option<PresetArg>,
    /// Override the passphrase profile's Argon2 iteration count. A salt file
    /// created by this tool records the cost it was first used with; a later
    /// run asking for a different one fails closed.
    #[arg(long, requires = "passphrase")]
    pub(crate) argon2_iters: Option<u32>,
    /// Override the passphrase profile's Argon2 memory cost (KiB).
    #[arg(long, requires = "passphrase")]
    pub(crate) argon2_memory_kb: Option<u32>,
    /// Input/output format: csv (default), tsv or jsonl;
    /// inferred from the file extensions when omitted. `-` paths mean
    /// stdin/stdout.
    #[arg(long, value_enum)]
    pub(crate) format: Option<Format>,
    /// Override the passphrase profile's Argon2 lane count.
    #[arg(long, requires = "passphrase")]
    pub(crate) argon2_threads: Option<u32>,
    /// Keyed-hash token length in bytes: 16 (default, 32 hex
    /// chars) is collision-safe beyond ~10¹² distinct values; 8 is compact
    /// but only safe to ~190 K. A collision is a permanent false join.
    #[arg(long, default_value_t = anonymiser_core::DEFAULT_TOKEN_BYTES)]
    pub(crate) token_bytes: usize,
    /// Token alphabet: hex (default, byte-for-byte
    /// v1 parity) or base32 (lowercase RFC 4648 unpadded; 16 bytes → 26
    /// chars). Printing only — collision behaviour is set by --token-bytes.
    #[arg(long, value_enum, default_value = "hex")]
    pub(crate) token_encoding: TokenEncodingArg,
    /// Columns to anonymise: comma-separated header names or indices
    /// (0-based), each with an optional `:suffix` — a canon type
    /// (`email:email`) or a generalisation (`dob:age-band`, `score:bucket=5`,
    /// `joined:year`).
    #[arg(long)]
    pub(crate) columns: Option<String>,
    /// Policy per anonymised column: hash (default), redact, mask, faux,
    /// encrypt, a generalisation (year, age-band, bucket), or a
    /// legacy- one (legacy-hmac-sha256, legacy-sha256, legacy-mask,
    /// legacy-aes, legacy-kyber-aes). A `--columns` entry can override it
    /// per column: `dob:age-band,score:bucket=5,email:email`.
    #[arg(long, default_value = "hash", conflicts_with = "policy_file")]
    pub(crate) policy: PolicyArg,
    /// Per-column policy file (same format the web app exports): JSON
    /// {"version":1,"columns":[{"name":"email","index":0,"action":"hash"}]}.
    /// Columns not listed are kept. Mutually exclusive with --columns/--policy.
    #[arg(long)]
    pub(crate) policy_file: Option<PathBuf>,
    /// Date `age-band` columns compute ages on, yyyy-mm-dd.
    /// Required when any column uses age-band: there is deliberately no
    /// default, so the output never depends on today's date.
    #[arg(long, value_name = "YYYY-MM-DD")]
    pub(crate) reference_date: Option<String>,
    /// Default band/bucket width for age-band and bucket columns that give
    /// none of their own (default 10; `col:bucket=5` or a policy-file
    /// `"width"` override it per column).
    #[arg(long, value_name = "N")]
    pub(crate) width: Option<u32>,
    /// Legacy key: the old web app's `global_key` string, used verbatim by
    /// legacy-* policies and to decrypt old `enc:`/`qenc:` cells in --decrypt
    /// mode. Independent of the master key file.
    #[arg(long)]
    pub(crate) legacy_key: Option<String>,
    /// Decrypt mode: reverse `enc:v1:` cells and the `kyber:v1:` cells of the
    /// deprecated kyber-aes policy (same master key
    /// and salt used to encrypt) and old web app `enc:` / `qenc:` cells (same
    /// --legacy-key as the old global key) instead of anonymising.
    #[arg(long)]
    pub(crate) decrypt: bool,
    /// Anonymise every column: explicit opt-in. Without one of --columns,
    /// --policy-file or --all-columns the run refuses to start — a missing
    /// flag must never silently mean "anonymise everything".
    #[arg(long, conflicts_with = "columns", conflicts_with = "policy_file")]
    pub(crate) all_columns: bool,
    /// Dataset namespace for column keys: binds key derivation
    /// to the dataset id, so different datasets never share tokens even with
    /// the same master key, salt and header names. Runs without --dataset
    /// keep the v1 key schedule. Must not be empty or contain NUL bytes.
    #[arg(long, value_parser = non_empty_dataset)]
    pub(crate) dataset: Option<String>,
    /// One shared token namespace for all anonymised columns: the same value
    /// in any of them maps to the same pseudonym (per-column
    /// keys otherwise break cross-column joins like email and alt_email).
    #[arg(long, requires = "columns")]
    pub(crate) join_group: Option<String>,
    /// Quasi-identifier columns (comma-separated header names or 0-based
    /// indices) for k-anonymity suppression, applied to the output of the
    /// policies. Needs --min-group.
    #[arg(
        long,
        value_name = "COLS",
        requires = "min_group",
        conflicts_with_all = ["decrypt", "reversible"]
    )]
    pub(crate) quasi_identifiers: Option<String>,
    /// Smallest group size k (>= 2): every combination of the quasi-identifier
    /// values left in the output is shared by at least k rows. Smaller groups
    /// are suppressed (see --suppress). Needs --quasi-identifiers.
    #[arg(long, value_name = "K", requires = "quasi_identifiers")]
    pub(crate) min_group: Option<usize>,
    /// How groups smaller than --min-group are suppressed: `cells` (default;
    /// the quasi-identifier cells become `*`) or `rows` (the rows are
    /// dropped). Buffers the output in memory.
    #[arg(long, value_enum, requires = "quasi_identifiers")]
    pub(crate) suppress: Option<SuppressArg>,
    /// Do not write the run manifest. By default every file-output run also
    /// writes `<outfile>.manifest.json` (0600): tool version, settings, KDF
    /// parameters, column plan, salt fingerprint and input/output SHA-256 —
    /// no secrets, no data values. `-` (stdout) and --decrypt
    /// runs never write one.
    #[arg(long)]
    pub(crate) no_manifest: bool,
    /// Overwrite the output file if it already exists (a previous
    /// run's outputs are never truncated silently).
    #[arg(long)]
    pub(crate) force: bool,
    /// Reversible mode: seal every `token → canonical value`
    /// pair into an append-only mapping sidecar that `anonymiser depseudo`
    /// can open with the same master key and salt. Requires --dataset.
    #[arg(
        long,
        requires = "dataset",
        conflicts_with_all = ["oneshot", "decrypt"]
    )]
    pub(crate) reversible: bool,
    /// Mapping sidecar path for --reversible (default: `<dataset>.mapping`).
    #[arg(long, requires = "reversible")]
    pub(crate) mapping_file: Option<PathBuf>,
    /// TOML file of default flag values, keyed by
    /// long-flag name (`columns = "email:email"`, `dataset = "customers"`).
    /// Profile values are defaults: an explicitly passed flag always wins;
    /// unknown keys abort. Applied before any other processing.
    #[arg(long, value_name = "FILE")]
    pub(crate) profile: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, ValueEnum, PartialEq, Eq)]
pub(crate) enum SuppressArg {
    /// Replace the quasi-identifier cells of small groups with `*`.
    Cells,
    /// Drop the rows of small groups.
    Rows,
}

impl From<SuppressArg> for anonymiser_core::SuppressMode {
    fn from(a: SuppressArg) -> Self {
        anonymiser_core::SuppressMode::from_str(
            a.to_possible_value().expect("derived ValueEnum").get_name(),
        )
        .expect("CLI suppression spellings mirror the core wire vocabulary")
    }
}

#[derive(Clone, Copy, Debug, ValueEnum, PartialEq, Eq)]
pub(crate) enum TokenEncodingArg {
    Hex,
    Base32,
}

impl From<TokenEncodingArg> for TokenEncoding {
    fn from(e: TokenEncodingArg) -> Self {
        TokenEncoding::from_str(e.to_possible_value().expect("derived ValueEnum").get_name())
            .expect("CLI alphabet spellings mirror the core wire vocabulary")
    }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum PolicyArg {
    Hash,
    Redact,
    Mask,
    Faux,
    /// Date → four-digit year.
    Year,
    /// Date of birth → age band (`30-39`, `90+`); needs --reference-date.
    AgeBand,
    /// Number → `lo-hi` range (`20-29`).
    Bucket,
    Encrypt,
    #[value(hide = true)]
    KyberAes,
    /// Old web app HMAC-SHA256 (16 hex chars, keyed by the master key bytes).
    LegacyHmacSha256,
    /// Old web app SHA-256 (16 hex chars).
    LegacySha256,
    /// Old web app whole-cell mask (`J******e`).
    LegacyMask,
    /// Old web app AES-256-GCM (`enc:` cells).
    LegacyAes,
    /// Old web app "kyber"-AES (`qenc:` cells).
    LegacyKyberAes,
}

impl From<PolicyArg> for Policy {
    fn from(p: PolicyArg) -> Self {
        Policy::from_str(p.to_possible_value().expect("derived ValueEnum").get_name())
            .expect("CLI policy spellings mirror the core wire vocabulary")
    }
}

pub(crate) fn non_empty_dataset(s: &str) -> Result<String, String> {
    if s.is_empty() {
        Err("dataset namespace must not be empty; omit it for unscoped keys".into())
    } else {
        Ok(s.to_string())
    }
}
