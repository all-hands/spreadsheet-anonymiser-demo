use crate::args::{AnonymiseArgs, PolicyArg};
use anyhow::{anyhow, Context, Result};
use clap::parser::ValueSource;
use clap::{ArgMatches, ValueEnum};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
struct AnonymiseProfile {
    master_key_file: Option<PathBuf>,
    salt_file: Option<PathBuf>,
    allow_legacy_key: Option<bool>,
    oneshot: Option<bool>,
    all_columns: Option<bool>,
    force: Option<bool>,
    no_manifest: Option<bool>,
    reversible: Option<bool>,
    decrypt: Option<bool>,
    columns: Option<String>,
    policy: Option<String>,
    policy_file: Option<PathBuf>,
    reference_date: Option<String>,
    width: Option<u32>,
    legacy_key: Option<String>,
    dataset: Option<String>,
    join_group: Option<String>,
    mapping_file: Option<PathBuf>,
    token_bytes: Option<usize>,
    format: Option<String>,
}

pub(crate) fn apply_profile(
    args: &mut AnonymiseArgs,
    matches: &ArgMatches,
    path: &Path,
) -> Result<()> {
    let raw = fs::read_to_string(path).with_context(|| format!("read profile {path:?}"))?;
    merge_profile(args, matches, &raw, path)
}

fn on_command_line(matches: &ArgMatches, id: &str) -> bool {
    matches.value_source(id) == Some(ValueSource::CommandLine)
}

fn merge_profile(
    args: &mut AnonymiseArgs,
    matches: &ArgMatches,
    raw: &str,
    src: &Path,
) -> Result<()> {
    let p: AnonymiseProfile =
        toml::from_str(raw).with_context(|| format!("parse profile {src:?}"))?;

    if let Some(v) = p.master_key_file {
        if !on_command_line(matches, "master_key_file") {
            args.master_key_file = v;
        }
    }
    if let Some(v) = p.salt_file {
        if !on_command_line(matches, "salt_file") && !args.oneshot {
            args.salt_file = v;
        }
    }
    args.allow_legacy_key |= p.allow_legacy_key.unwrap_or(false);
    args.oneshot |= p.oneshot.unwrap_or(false);
    args.all_columns |= p.all_columns.unwrap_or(false);
    args.force |= p.force.unwrap_or(false);
    args.no_manifest |= p.no_manifest.unwrap_or(false);
    args.reversible |= p.reversible.unwrap_or(false);
    args.decrypt |= p.decrypt.unwrap_or(false);
    if args.columns.is_none() {
        args.columns = p.columns;
    }
    if let Some(v) = p.policy {
        if !on_command_line(matches, "policy") {
            args.policy = PolicyArg::from_str(&v, false)
                .map_err(|e| anyhow!("profile {src:?}: invalid policy: {e}"))?;
        }
    }
    if args.policy_file.is_none() {
        args.policy_file = p.policy_file;
    }
    if args.reference_date.is_none() {
        args.reference_date = p.reference_date;
    }
    if args.width.is_none() {
        args.width = p.width;
    }
    if args.legacy_key.is_none() {
        args.legacy_key = p.legacy_key;
    }
    if args.dataset.is_none() {
        args.dataset = p.dataset;
    }
    if args.join_group.is_none() {
        args.join_group = p.join_group;
    }
    if args.mapping_file.is_none() {
        args.mapping_file = p.mapping_file;
    }
    if let Some(v) = p.token_bytes {
        if !on_command_line(matches, "token_bytes") {
            if v == 0 || v > anonymiser_core::MAX_TOKEN_BYTES {
                anyhow::bail!(
                    "profile {src:?}: token-bytes {v} out of range 1..={}",
                    anonymiser_core::MAX_TOKEN_BYTES
                );
            }
            args.token_bytes = v;
        }
    }
    if let Some(v) = p.format {
        if args.format.is_none() {
            args.format = Some(
                crate::io::Format::from_str(&v, false)
                    .map_err(|e| anyhow!("profile {src:?}: invalid format: {e}"))?,
            );
        }
    }
    Ok(())
}

pub(crate) fn validate_merged(args: &AnonymiseArgs) -> Result<()> {
    if args.dataset.as_deref() == Some("") {
        anyhow::bail!("dataset namespace must not be empty; omit it for unscoped keys");
    }
    if args.reversible {
        if args.dataset.is_none() {
            anyhow::bail!("--reversible requires --dataset (profile-merged)");
        }
        if args.oneshot {
            anyhow::bail!("--reversible conflicts with --oneshot (profile-merged)");
        }
        if args.decrypt {
            anyhow::bail!("--reversible conflicts with --decrypt (profile-merged)");
        }
    }
    if args.mapping_file.is_some() && !args.reversible {
        anyhow::bail!("--mapping-file requires --reversible (profile-merged)");
    }
    if args.join_group.is_some() && args.columns.is_none() && args.policy_file.is_none() {
        anyhow::bail!("--join-group requires --columns (profile-merged)");
    }
    if args.policy_file.is_some() && (args.columns.is_some() || args.all_columns) {
        anyhow::bail!(
            "--policy-file is mutually exclusive with --columns/--all-columns (profile-merged)"
        );
    }
    if args.policy_file.is_some() && !matches!(args.policy, PolicyArg::Hash) {
        anyhow::bail!("--policy conflicts with --policy-file (profile-merged)");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::{CommandFactory as _, FromArgMatches as _};

    struct Parsed {
        args: AnonymiseArgs,
        matches: ArgMatches,
    }

    impl Parsed {
        fn merge(&mut self, toml_text: &str) {
            self.try_merge(toml_text).expect("profile merges");
        }

        fn try_merge(&mut self, toml_text: &str) -> Result<()> {
            merge_profile(
                &mut self.args,
                &self.matches,
                toml_text,
                Path::new("test-profile.toml"),
            )
        }
    }

    fn base_args(extra: &[&str]) -> Parsed {
        let mut argv = vec!["anonymise", "in.csv", "out.csv"];
        argv.extend_from_slice(extra);
        let matches = AnonymiseArgs::command().get_matches_from(argv);
        let args = AnonymiseArgs::from_arg_matches(&matches).expect("valid test argv");
        Parsed { args, matches }
    }

    #[test]
    fn explicit_flag_beats_profile_default() {
        let mut a = base_args(&["--columns", "email", "--dataset", "d1", "--force"]);
        a.merge("columns = \"a,b\"\ndataset = \"d2\"\n");
        assert_eq!(a.args.columns.as_deref(), Some("email"));
        assert_eq!(a.args.dataset.as_deref(), Some("d1"));

        let mut b = base_args(&["--token-bytes", "8"]);
        b.merge("token-bytes = 32\n");
        assert_eq!(b.args.token_bytes, 8);
    }

    #[test]
    fn explicit_flag_equal_to_the_default_beats_the_profile() {
        let mut a = base_args(&[
            "--token-bytes",
            "16",
            "--policy",
            "hash",
            "--master-key-file",
            "master_key.bin",
            "--salt-file",
            "anonymiser.salt",
        ]);
        a.merge(
            "token-bytes = 8\npolicy = \"redact\"\n\
             master-key-file = \"other.key\"\nsalt-file = \"other.salt\"\n",
        );
        assert_eq!(a.args.token_bytes, 16);
        assert!(matches!(a.args.policy, PolicyArg::Hash));
        assert_eq!(a.args.master_key_file, Path::new("master_key.bin"));
        assert_eq!(a.args.salt_file, Path::new("anonymiser.salt"));
    }

    #[test]
    fn no_flag_takes_the_profile_value() {
        let mut a = base_args(&[]);
        a.merge(
            "token-bytes = 8\npolicy = \"redact\"\n\
             master-key-file = \"other.key\"\nsalt-file = \"other.salt\"\n",
        );
        assert_eq!(a.args.token_bytes, 8);
        assert!(matches!(a.args.policy, PolicyArg::Redact));
        assert_eq!(a.args.master_key_file, Path::new("other.key"));
        assert_eq!(a.args.salt_file, Path::new("other.salt"));
    }

    #[test]
    fn no_flag_and_no_profile_value_keeps_the_default() {
        let mut a = base_args(&[]);
        a.merge("dataset = \"d\"\n");
        assert_eq!(a.args.token_bytes, anonymiser_core::DEFAULT_TOKEN_BYTES);
        assert!(matches!(a.args.policy, PolicyArg::Hash));
        assert_eq!(a.args.master_key_file, Path::new("master_key.bin"));
        assert_eq!(a.args.salt_file, Path::new("anonymiser.salt"));
    }

    #[test]
    fn profile_fills_unset_flags() {
        let mut a = base_args(&[]);
        a.merge(
            "columns = \"email\"\ndataset = \"customers\"\ntoken-bytes = 8\n\
             legacy-key = \"old-global-key\"\nformat = \"tsv\"\nforce = true\n",
        );
        assert_eq!(a.args.columns.as_deref(), Some("email"));
        assert_eq!(a.args.dataset.as_deref(), Some("customers"));
        assert_eq!(a.args.token_bytes, 8);
        assert_eq!(a.args.legacy_key.as_deref(), Some("old-global-key"));
        assert_eq!(a.args.format.map(|f| f.name()), Some("tsv"));
        assert!(a.args.force, "boolean flags OR the profile in");
    }

    #[test]
    fn unknown_key_aborts() {
        let mut a = base_args(&[]);
        let err = a
            .try_merge("no-such-flag = true\n")
            .expect_err("a typo'd profile must fail closed");
        let msg = format!("{err:#}");
        assert!(msg.contains("unknown field"), "got: {msg}");
        assert!(msg.contains("parse profile"), "error names the file: {msg}");
    }

    #[test]
    fn profile_token_bytes_out_of_range_aborts() {
        for v in [0usize, 65] {
            let mut a = base_args(&[]);
            let err = a
                .try_merge(&format!("token-bytes = {v}\n"))
                .expect_err("token length is bounded");
            assert!(
                err.to_string().contains("out of range"),
                "token-bytes {v}: {err}"
            );
        }
    }

    type Rule = (&'static str, Box<dyn Fn(&mut Parsed)>, &'static str);

    #[test]
    fn validate_merged_enforces_cross_field_rules() {
        let cases: [Rule; 7] = [
            (
                "reversible without dataset",
                Box::new(|a: &mut Parsed| a.merge("reversible = true\n")),
                "--reversible requires --dataset",
            ),
            (
                "reversible + oneshot",
                Box::new(|a: &mut Parsed| a.merge("reversible = true\noneshot = true\n")),
                "--reversible conflicts with --oneshot",
            ),
            (
                "reversible + decrypt",
                Box::new(|a: &mut Parsed| a.merge("reversible = true\ndecrypt = true\n")),
                "--reversible conflicts with --decrypt",
            ),
            (
                "mapping-file without reversible",
                Box::new(|a: &mut Parsed| a.merge("mapping-file = \"d.mapping\"\n")),
                "--mapping-file requires --reversible",
            ),
            (
                "join-group without columns",
                Box::new(|a: &mut Parsed| a.merge("join-group = \"g\"\n")),
                "--join-group requires --columns",
            ),
            (
                "policy-file + columns",
                Box::new(|a: &mut Parsed| a.merge("policy-file = \"p.json\"\n")),
                "--policy-file is mutually exclusive",
            ),
            (
                "policy + policy-file",
                Box::new(|a: &mut Parsed| {
                    a.merge("policy = \"redact\"\npolicy-file = \"p.json\"\n")
                }),
                "--policy conflicts with --policy-file",
            ),
        ];
        let seeds: [&[&str]; 7] = [
            &[],
            &["--dataset", "d"],
            &["--dataset", "d"],
            &[],
            &[],
            &["--columns", "a"],
            &[],
        ];
        for ((label, apply, want), seed) in cases.into_iter().zip(seeds) {
            let mut a = base_args(seed);
            apply(&mut a);
            let err = validate_merged(&a.args).expect_err(label);
            assert!(err.to_string().contains(want), "{label}: {err}");
        }

        let mut a = base_args(&["--all-columns"]);
        a.merge("policy-file = \"p.json\"\n");
        assert!(validate_merged(&a.args).is_err());

        let mut ok = base_args(&[]);
        ok.merge("join-group = \"g\"\npolicy-file = \"p.json\"\n");
        assert!(validate_merged(&ok.args).is_ok());

        let mut ok2 = base_args(&["--policy", "hash"]);
        ok2.merge("policy = \"redact\"\npolicy-file = \"p.json\"\n");
        assert!(matches!(ok2.args.policy, PolicyArg::Hash));
        assert!(validate_merged(&ok2.args).is_ok());
    }
}
