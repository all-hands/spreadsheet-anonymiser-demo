use crate::common::{bin, tmpdir, write_key};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Output;

const NOTICE: &str = "policy \"kyber-aes\" is deprecated and refused for new runs: its \
     ML-KEM layer is keyed from the column key, so it adds no protection over \
     AES-256-GCM; use \"encrypt\" instead (existing kyber:v1: cells still decrypt)";

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/kyber-0.0.2")
        .join(name)
}

fn run_dir(tag: &str) -> crate::common::TestDir {
    let d = tmpdir(tag);
    fs::write(d.join("in.csv"), "name,note\nAlice Smith,visible\n").unwrap();
    d
}

fn anonymise(d: &Path, extra: &[&str]) -> Output {
    bin()
        .arg("anonymise")
        .arg(d.join("in.csv"))
        .arg(d.join("out.csv"))
        .arg("--master-key-file")
        .arg(d.join("key.bin"))
        .arg("--salt-file")
        .arg(d.join("run.salt"))
        .args(extra)
        .env("RUST_BACKTRACE", "0")
        .output()
        .unwrap()
}

fn assert_refused(d: &Path, out: &Output, how: &str) {
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(!out.status.success(), "{how}: run succeeded");
    assert!(stderr.contains(NOTICE), "{how}: stderr was {stderr}");
    let mut left: Vec<String> = fs::read_dir(d)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n != "in.csv" && n != "policy.json" && n != "profile.toml")
        .collect();
    left.sort();
    assert!(left.is_empty(), "{how}: run left {left:?}");
}

#[test]
fn anonymise_refuses_kyber_aes_however_it_is_named() {
    let d = run_dir("kyber-policy-flag");
    let out = anonymise(&d, &["--columns", "name", "--policy", "kyber-aes"]);
    assert_refused(&d, &out, "--policy kyber-aes");

    let d = run_dir("kyber-columns-suffix");
    let out = anonymise(&d, &["--columns", "name:kyber-aes"]);
    assert_refused(&d, &out, "--columns name:kyber-aes");

    let d = run_dir("kyber-policy-file");
    fs::write(
        d.join("policy.json"),
        r#"{"version":1,"columns":[{"name":"name","index":0,"action":"kyber-aes"}]}"#,
    )
    .unwrap();
    let pf = d.join("policy.json");
    let out = anonymise(&d, &["--policy-file", pf.to_str().unwrap()]);
    assert_refused(&d, &out, "policy file action");

    let d = run_dir("kyber-profile-policy");
    fs::write(
        d.join("profile.toml"),
        "columns = \"name\"\npolicy = \"kyber-aes\"\n",
    )
    .unwrap();
    let prof = d.join("profile.toml");
    let out = anonymise(&d, &["--profile", prof.to_str().unwrap()]);
    assert_refused(&d, &out, "profile policy");

    let d = run_dir("kyber-profile-policy-file");
    fs::write(
        d.join("policy.json"),
        r#"{"version":1,"columns":[{"index":0,"action":"kyber-aes"}]}"#,
    )
    .unwrap();
    fs::write(
        d.join("profile.toml"),
        format!("policy-file = {:?}\n", d.join("policy.json")),
    )
    .unwrap();
    let prof = d.join("profile.toml");
    let out = anonymise(&d, &["--profile", prof.to_str().unwrap()]);
    assert_refused(&d, &out, "profile policy-file");
}

#[test]
fn refusal_is_not_a_switch_to_encrypt() {
    let d = run_dir("kyber-existing-key");
    write_key(&d.join("key.bin"), &[3u8; 64]);
    fs::write(d.join("run.salt"), [5u8; 32]).unwrap();
    let out = anonymise(&d, &["--columns", "name", "--policy", "kyber-aes"]);
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains(NOTICE));
    assert!(!d.join("out.csv").exists());

    let out = anonymise(&d, &["--columns", "name", "--policy", "encrypt"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let enc = fs::read_to_string(d.join("out.csv")).unwrap();
    assert!(
        enc.contains("enc:v1:") && !enc.contains("kyber:v1:"),
        "{enc}"
    );
}

#[test]
fn help_no_longer_offers_kyber_aes() {
    let out = bin().args(["anonymise", "--help"]).output().unwrap();
    let help = String::from_utf8_lossy(&out.stdout);
    assert!(help.contains("- legacy-kyber-aes"), "{help}");
    assert!(!help.contains("- kyber-aes"), "{help}");
    assert!(!help.contains("encrypt, kyber-aes"), "{help}");
}

#[test]
fn inspect_refuses_a_plan_that_names_kyber_aes() {
    let d = run_dir("kyber-inspect");
    let out = bin()
        .args(["inspect"])
        .arg(d.join("in.csv"))
        .args(["--columns", "name", "--policy", "kyber-aes"])
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains(NOTICE));

    let out = bin()
        .args(["inspect"])
        .arg(fixture("in.csv"))
        .arg("--policy-file")
        .arg(fixture("policy.json"))
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains(NOTICE));

    let out = bin()
        .args(["inspect"])
        .arg(fixture("out.csv"))
        .args(["--columns", "note"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn released_kyber_cells_still_decrypt() {
    let original = fs::read_to_string(fixture("in.csv")).unwrap();
    let name_col = |s: &str| -> Vec<String> {
        s.lines()
            .map(|l| l.split(',').next().unwrap_or_default().to_string())
            .collect()
    };
    let old = fs::read_to_string(fixture("out.csv")).unwrap();
    assert_eq!(old.matches("kyber:v1:").count(), 2, "{old}");

    for with_policy_file in [false, true] {
        let d = tmpdir("kyber-decrypt");
        let mut cmd = bin();
        cmd.arg("anonymise")
            .arg(fixture("out.csv"))
            .arg(d.join("dec.csv"))
            .arg("--decrypt")
            .arg("--master-key-file")
            .arg(fixture("key.bin"))
            .arg("--salt-file")
            .arg(fixture("salt.anonsalt"))
            .args(["--dataset", "demo", "--no-manifest"]);
        if with_policy_file {
            cmd.arg("--policy-file").arg(fixture("policy.json"));
        }
        let out = cmd.output().unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let dec = fs::read_to_string(d.join("dec.csv")).unwrap();
        assert_eq!(name_col(&dec), name_col(&original), "{dec}");
        assert!(!dec.contains("kyber:v1:"));
    }
}

#[test]
fn released_passphrase_kyber_cells_still_decrypt() {
    let d = tmpdir("kyber-decrypt-pp");
    let out = bin()
        .arg("anonymise")
        .arg(fixture("pp-out.csv"))
        .arg(d.join("dec.csv"))
        .arg("--decrypt")
        .args(["--passphrase", "correct horse battery staple"])
        .arg("--salt-file")
        .arg(fixture("pp-salt.anonsalt"))
        .args(["--dataset", "demo", "--no-manifest"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        fs::read(d.join("dec.csv")).unwrap(),
        fs::read(fixture("in.csv")).unwrap()
    );
}

fn verify(extra: &[&str]) -> Output {
    bin()
        .arg("verify")
        .arg(fixture("out.csv"))
        .arg("--master-key-file")
        .arg(fixture("key.bin"))
        .arg("--salt-file")
        .arg(fixture("salt.anonsalt"))
        .args(extra)
        .output()
        .unwrap()
}

#[test]
fn verify_accepts_the_released_kyber_run() {
    let manifest = fixture("out.csv.manifest.json");
    let manifest = manifest.to_str().unwrap();
    let original = fixture("in.csv");
    let original = original.to_str().unwrap();
    let policy = fixture("policy.json");
    let policy = policy.to_str().unwrap();
    let cases: [Vec<&str>; 3] = [
        vec!["--manifest", manifest],
        vec!["--manifest", manifest, "--against", original],
        vec![
            "--dataset",
            "demo",
            "--policy-file",
            policy,
            "--against",
            original,
        ],
    ];
    for args in cases {
        let out = verify(&args);
        let stdout = String::from_utf8_lossy(&out.stdout);
        assert!(
            out.status.success(),
            "{args:?}: {stdout}{}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(stdout.contains("verify: all checks passed"), "{stdout}");
        if args.contains(&"--against") {
            assert!(stdout.contains("3 token cells match"), "{stdout}");
        }
    }
}
