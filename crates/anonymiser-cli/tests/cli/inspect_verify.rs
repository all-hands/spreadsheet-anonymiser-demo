use crate::common::{bin, fast_key_args, run_cli, svec, tmpdir, write_key};
use std::fs;

#[test]
fn inspect_reports_plan_risk_and_writes_nothing() {
    let d = tmpdir("inspect");
    fs::write(
        d.join("in.csv"),
        "email,amount,note\na@b.com,9.8,\nc@d.io,9.8,\ne@f.io,7.5,\n",
    )
    .unwrap();
    write_key(&d.join("key.bin"), &[4u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();

    let out = bin()
        .arg("inspect")
        .arg(d.join("in.csv"))
        .args(["--columns", "email,note"])
        .env("RUST_BACKTRACE", "0")
        .output()
        .unwrap();
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    let email_line = stdout
        .lines()
        .find(|l| l.contains("email") && !l.starts_with("Inspecting"))
        .unwrap();
    assert!(email_line.contains("hash"), "plan row: {email_line}");
    let amount_line = stdout.lines().find(|l| l.contains("amount")).unwrap();
    assert!(amount_line.contains("keep"), "plan row: {amount_line}");
    assert!(
        stdout.contains("entirely blank — empty cells pass through"),
        "blank-column warning: {stdout}"
    );
    assert!(
        stdout.contains("k=1 for 1/3 rows (33%)"),
        "k-anonymity of kept columns: {stdout}"
    );
    assert!(
        stdout.contains("none matched email/phone patterns"),
        "PII scan scoped to kept columns: {stdout}"
    );
    assert!(!stdout.contains("Sample: "), "no key, no samples: {stdout}");
    assert!(stdout.contains("dry-run only"), "{stdout}");
}

#[test]
fn inspect_flags_clear_pii_in_kept_columns() {
    let d = tmpdir("inspect-pii");
    fs::write(
        d.join("in.csv"),
        "id,contact\n1,a@b.com\n2,+44 161 1234567\n",
    )
    .unwrap();

    let out = bin()
        .arg("inspect")
        .arg(d.join("in.csv"))
        .args(["--columns", "id"])
        .output()
        .unwrap();
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("email-like values: contact (1)"),
        "email hint on kept column: {stdout}"
    );
    assert!(
        stdout.contains("phone-like values: contact (1)"),
        "phone hint on kept column: {stdout}"
    );
}

#[test]
fn inspect_sample_tokens_match_a_real_run() {
    let d = tmpdir("inspect-sample");
    fs::write(d.join("in.csv"), "email\nx@y.z\n").unwrap();
    write_key(&d.join("key.bin"), &[6u8; 64]);
    fs::write(d.join("salt.bin"), [2u8; 32]).unwrap();

    let insp = bin()
        .arg("inspect")
        .arg(d.join("in.csv"))
        .args(["--columns", "email", "--master-key-file"])
        .arg(d.join("key.bin"))
        .arg("--salt-file")
        .arg(d.join("salt.bin"))
        .output()
        .unwrap();
    assert!(insp.status.success());
    let stdout = String::from_utf8_lossy(&insp.stdout);
    let sample = stdout
        .lines()
        .find(|l| l.starts_with("Sample: "))
        .expect("sample line present when key+salt exist");
    let token = sample
        .split('→')
        .nth(1)
        .unwrap()
        .trim()
        .split(' ')
        .next()
        .unwrap();

    let real = run_cli(
        &d,
        "in.csv",
        &[fast_key_args(&d), svec(["--columns", "email"])].concat(),
    );
    assert!(real.status.success());
    let written = fs::read_to_string(d.join("out.csv")).unwrap();
    assert!(
        written.contains(token),
        "dry-run sample must equal the real run's token: {written} vs {token}"
    );
}

#[test]
fn inspect_fails_closed_without_selection() {
    let d = tmpdir("inspect-fail");
    fs::write(d.join("in.csv"), "email\nx@y.z\n").unwrap();
    let out = bin().arg("inspect").arg(d.join("in.csv")).output().unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("no columns selected"));
}

#[test]
fn verify_passes_on_honest_output_and_catches_wrong_key() {
    let d = tmpdir("verify");
    fs::write(d.join("in.csv"), "email,note\na@b.com,x\nc@d.io,y\n").unwrap();
    write_key(&d.join("key.bin"), &[8u8; 64]);
    write_key(&d.join("other.bin"), &[9u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();

    let run = run_cli(
        &d,
        "in.csv",
        &[fast_key_args(&d), svec(["--columns", "email"])].concat(),
    );
    assert!(run.status.success());

    let verify = |key: &str| -> std::process::Output {
        bin()
            .arg("verify")
            .arg(d.join("out.csv"))
            .arg("--master-key-file")
            .arg(d.join(key))
            .arg("--salt-file")
            .arg(d.join("salt.bin"))
            .arg("--against")
            .arg(d.join("in.csv"))
            .env("RUST_BACKTRACE", "0")
            .output()
            .unwrap()
    };

    let good = verify("key.bin");
    assert!(good.status.success());
    let stdout = String::from_utf8_lossy(&good.stdout);
    assert!(stdout.contains("✓ key id "), "{stdout}");
    assert!(stdout.contains("2 cells are 32-hex tokens"), "{stdout}");
    assert!(
        stdout.contains("re-derivation: 2 token cells match"),
        "{stdout}"
    );
    assert!(stdout.contains("all checks passed"), "{stdout}");

    let bad = verify("other.bin");
    assert!(!bad.status.success());
    let out = String::from_utf8_lossy(&bad.stdout);
    assert!(out.contains("re-derivation failed"), "{out}");
    assert!(out.contains("row 0, column email"), "{out}");
}

#[test]
fn verify_detects_tampered_and_non_token_cells() {
    let d = tmpdir("verify-tamper");
    fs::write(d.join("out.csv"), "email,note\nZorua plaintext,ok\n").unwrap();
    write_key(&d.join("key.bin"), &[8u8; 64]);

    let out = bin()
        .arg("verify")
        .arg(d.join("out.csv"))
        .arg("--columns")
        .arg("email")
        .arg("--master-key-file")
        .arg(d.join("key.bin"))
        .output()
        .unwrap();
    assert!(!out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("NOT 32-hex tokens"),
        "tampered cell must fail the shape check: {stdout}"
    );
}

#[test]
fn verify_warns_but_passes_on_kept_pii() {
    let d = tmpdir("verify-pii");
    write_key(&d.join("key.bin"), &[8u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();
    fs::write(d.join("in.csv"), "id,contact\n1,a@b.com\n2,c@d.io\n").unwrap();
    let run = run_cli(
        &d,
        "in.csv",
        &[fast_key_args(&d), svec(["--columns", "id"])].concat(),
    );
    assert!(run.status.success());

    let out = bin()
        .arg("verify")
        .arg(d.join("out.csv"))
        .arg("--columns")
        .arg("id")
        .arg("--master-key-file")
        .arg(d.join("key.bin"))
        .arg("--salt-file")
        .arg(d.join("salt.bin"))
        .arg("--against")
        .arg(d.join("in.csv"))
        .output()
        .unwrap();
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("PII-shaped values"),
        "kept PII is flagged loudly: {stdout}"
    );
    assert!(stdout.contains("all checks passed"), "{stdout}");
}

#[test]
fn verify_rederives_per_column_groups_with_the_policy_file() {
    let d = tmpdir("verify-groups");
    fs::write(
        d.join("in.csv"),
        "email,phone\na@b.com,+441612345678\nc@d.io,+441632960961\n",
    )
    .unwrap();
    write_key(&d.join("key.bin"), &[3u8; 64]);
    fs::write(d.join("salt.bin"), [4u8; 32]).unwrap();
    fs::write(
        d.join("policy.json"),
        r#"{"version":1,"columns":[
            {"name":"email","action":"hash","group":"contact"},
            {"name":"phone","action":"hash","group":"tel"}]}"#,
    )
    .unwrap();

    let mut run_args = fast_key_args(&d);
    run_args.push("--policy-file".into());
    run_args.push(d.join("policy.json").display().to_string());
    let run = run_cli(&d, "in.csv", &run_args);
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    let stdout = String::from_utf8_lossy(&run.stdout);
    assert!(stdout.contains("email=hash~contact"), "{stdout}");
    assert!(stdout.contains("phone=hash~tel"), "{stdout}");

    let blind = bin()
        .arg("verify")
        .arg(d.join("out.csv"))
        .arg("--master-key-file")
        .arg(d.join("key.bin"))
        .arg("--salt-file")
        .arg(d.join("salt.bin"))
        .arg("--against")
        .arg(d.join("in.csv"))
        .env("RUST_BACKTRACE", "0")
        .output()
        .unwrap();
    assert!(!blind.status.success());
    let blind_out = String::from_utf8_lossy(&blind.stdout);
    assert!(blind_out.contains("re-derivation failed"), "{blind_out}");
    assert!(
        blind_out.contains("--policy-file"),
        "remedy named: {blind_out}"
    );

    let audited = bin()
        .arg("verify")
        .arg(d.join("out.csv"))
        .arg("--master-key-file")
        .arg(d.join("key.bin"))
        .arg("--salt-file")
        .arg(d.join("salt.bin"))
        .arg("--policy-file")
        .arg(d.join("policy.json"))
        .arg("--against")
        .arg(d.join("in.csv"))
        .env("RUST_BACKTRACE", "0")
        .output()
        .unwrap();
    assert!(
        audited.status.success(),
        "{}",
        String::from_utf8_lossy(&audited.stdout)
    );
    let ok = String::from_utf8_lossy(&audited.stdout);
    assert!(ok.contains("re-derivation: 4 token cells match"), "{ok}");
    assert!(ok.contains("all checks passed"), "{ok}");
}

#[test]
fn inspect_skips_samples_with_a_note_when_the_key_is_invalid() {
    let d = tmpdir("inspect-badkey");
    fs::write(d.join("in.csv"), "email\nx@y.z\n").unwrap();
    fs::write(d.join("key.bin"), b"not a key").unwrap();
    fs::write(d.join("salt.bin"), [2u8; 32]).unwrap();
    let insp = bin()
        .arg("inspect")
        .arg(d.join("in.csv"))
        .args(["--columns", "email", "--master-key-file"])
        .arg(d.join("key.bin"))
        .arg("--salt-file")
        .arg(d.join("salt.bin"))
        .output()
        .unwrap();
    let out = String::from_utf8_lossy(&insp.stdout);
    assert!(
        insp.status.success(),
        "{out}{}",
        String::from_utf8_lossy(&insp.stderr)
    );
    assert!(out.contains("Sample tokens skipped:"), "{out}");
    assert!(out.contains("Inspect wrote nothing"), "{out}");
    assert!(!out.contains("Sample: "), "{out}");
    assert_eq!(fs::read(d.join("key.bin")).unwrap(), b"not a key");
}
