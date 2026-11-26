use crate::common::{bin, fast_key_args, run_cli, svec, tmpdir, write_key};
use std::fs;

#[test]
fn column_selection_fails_closed() {
    let d = tmpdir("fail-closed");
    fs::write(d.join("in.csv"), "name,email\nJohn,j@s.io\n").unwrap();
    write_key(&d.join("key.bin"), &[1u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();

    let out = run_cli(
        &d,
        "in.csv",
        &[fast_key_args(&d), svec(["--columns", "emial"])].concat(),
    );
    let s = String::from_utf8_lossy(&out.stderr);
    assert!(!out.status.success(), "typo must abort");
    assert!(s.contains("emial") && s.contains("name, email"), "got: {s}");
    assert!(!d.join("out.csv").exists());

    let out = run_cli(
        &d,
        "in.csv",
        &[fast_key_args(&d), svec(["--columns", "9"])].concat(),
    );
    assert!(!out.status.success(), "out-of-range index must abort");
    assert!(String::from_utf8_lossy(&out.stderr).contains("out of range"));

    let out = run_cli(&d, "in.csv", &fast_key_args(&d));
    assert!(!out.status.success(), "missing selection must abort");
    assert!(String::from_utf8_lossy(&out.stderr).contains("no columns selected"));

    let out = run_cli(
        &d,
        "in.csv",
        &[fast_key_args(&d), svec(["--all-columns"])].concat(),
    );
    assert!(out.status.success());
}

#[test]
fn bom_header_matches_by_name() {
    let d = tmpdir("bom");
    write_key(&d.join("key.bin"), &[1u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();
    let fixture = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/members.csv");
    let out = bin()
        .arg("anonymise")
        .arg(fixture)
        .arg(d.join("out.csv"))
        .arg("--master-key-file")
        .arg(d.join("key.bin"))
        .arg("--salt-file")
        .arg(d.join("salt.bin"))
        .args(["--columns", "member_id"])
        .env("RUST_BACKTRACE", "0")
        .output()
        .unwrap();
    assert!(out.status.success(), "BOM must not break name matching");
    let written = fs::read_to_string(d.join("out.csv")).unwrap();
    assert!(
        written.starts_with("member_id,"),
        "BOM is stripped from the output header: {written:?}"
    );
}

#[test]
fn refuses_overwrite_without_force() {
    let d = tmpdir("force");
    fs::write(d.join("in.csv"), "name\nJohn\n").unwrap();
    write_key(&d.join("key.bin"), &[1u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();
    fs::write(d.join("out.csv"), "previous run\n").unwrap();

    let out = run_cli(
        &d,
        "in.csv",
        &[fast_key_args(&d), svec(["--columns", "name"])].concat(),
    );
    assert!(!out.status.success(), "must refuse to overwrite");
    assert!(String::from_utf8_lossy(&out.stderr).contains("--force"));
    assert_eq!(
        fs::read_to_string(d.join("out.csv")).unwrap(),
        "previous run\n"
    );

    let out = run_cli(
        &d,
        "in.csv",
        &[fast_key_args(&d), svec(["--columns", "name", "--force"])].concat(),
    );
    assert!(out.status.success());
    assert!(fs::read_to_string(d.join("out.csv"))
        .unwrap()
        .starts_with("name\n"));
}

#[test]
fn ragged_input_leaves_no_partial_output() {
    let d = tmpdir("ragged");
    fs::write(d.join("in.csv"), "name,note\nAlice,ok\nBob\n").unwrap();
    write_key(&d.join("key.bin"), &[1u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();

    let out = run_cli(
        &d,
        "in.csv",
        &[fast_key_args(&d), svec(["--columns", "name"])].concat(),
    );
    assert!(!out.status.success(), "ragged row must error");
    assert!(
        !d.join("out.csv").exists(),
        "failed run must not leave output behind"
    );
    let part = d.join("out.csv.part");
    assert!(!part.exists(), "temp file must be cleaned up: {:?}", part);
}

#[test]
fn summary_states_the_contract() {
    let d = tmpdir("summary");
    fs::write(d.join("in.csv"), "name,note\nJohn Smith,keep\n").unwrap();
    write_key(&d.join("key.bin"), &[5u8; 64]);
    fs::write(d.join("salt.bin"), [7u8; 32]).unwrap();

    let out = run_cli(
        &d,
        "in.csv",
        &[fast_key_args(&d), svec(["--columns", "name"])].concat(),
    );
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("(1 rows)"), "got: {stdout}");
    assert!(
        stdout.contains("Columns: 0:name=hash 1:note=keep"),
        "got: {stdout}"
    );
    assert!(
        stdout.contains("pseudonymised, not anonymous"),
        "honesty notice in every anonymise summary: {stdout}"
    );
    assert!(stdout.contains("Key fingerprint: "), "got: {stdout}");
    assert!(
        stdout.contains("Key schedule: HKDF-SHA512"),
        "got: {stdout}"
    );
}

#[test]
fn join_group_shares_tokens_across_columns() {
    let d = tmpdir("join-group");
    fs::write(d.join("in.csv"), "colour1,colour2,note\nred,red,x\n").unwrap();
    write_key(&d.join("key.bin"), &[1u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();

    let out = run_cli(
        &d,
        "in.csv",
        &[fast_key_args(&d), svec(["--columns", "colour1,colour2"])].concat(),
    );
    assert!(out.status.success());
    let written = fs::read_to_string(d.join("out.csv")).unwrap();
    let row: Vec<&str> = written.lines().nth(1).unwrap().split(',').collect();
    assert_ne!(row[0], row[1], "per-column keys must diverge");

    fs::remove_file(d.join("out.csv")).unwrap();
    let out = run_cli(
        &d,
        "in.csv",
        &[
            fast_key_args(&d),
            svec(["--columns", "colour1,colour2", "--join-group", "colours"]),
        ]
        .concat(),
    );
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("colour1=hash~colours"), "got: {stdout}");
    let written = fs::read_to_string(d.join("out.csv")).unwrap();
    let row: Vec<&str> = written.lines().nth(1).unwrap().split(',').collect();
    assert_eq!(row[0], row[1], "join group must share the token namespace");
}

#[test]
fn policy_file_groups_share_tokens() {
    let d = tmpdir("policy-groups");
    fs::write(d.join("in.csv"), "colour1,colour2\nred,red\n").unwrap();
    write_key(&d.join("key.bin"), &[1u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();
    fs::write(
        d.join("policy.json"),
        r#"{"version":1,"columns":[
            {"name":"colour1","action":"hash","group":"colours"},
            {"name":"colour2","action":"hash","group":"colours"}]}"#,
    )
    .unwrap();

    let mut args = fast_key_args(&d);
    args.push("--policy-file".into());
    args.push(d.join("policy.json").display().to_string());
    let out = run_cli(&d, "in.csv", &args);
    assert!(out.status.success());
    let written = fs::read_to_string(d.join("out.csv")).unwrap();
    let row: Vec<&str> = written.lines().nth(1).unwrap().split(',').collect();
    assert_eq!(
        row[0], row[1],
        "policy-file groups must share the namespace"
    );
}

#[test]
fn dataset_scoping_is_domain_separated() {
    let d = tmpdir("dataset");
    fs::write(d.join("in.csv"), "email\nj@s.io\n").unwrap();
    write_key(&d.join("key.bin"), &[1u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();

    let token = |outfile: &str, extra: &[&str]| -> String {
        let mut args = fast_key_args(&d);
        args.extend(extra.iter().map(|s| s.to_string()));
        let out = bin()
            .arg("anonymise")
            .arg(d.join("in.csv"))
            .arg(d.join(outfile))
            .args(args)
            .output()
            .unwrap();
        assert!(out.status.success());
        fs::read_to_string(d.join(outfile))
            .unwrap()
            .lines()
            .nth(1)
            .unwrap()
            .to_string()
    };

    let v1 = token("v1.csv", &["--columns", "email"]);
    let a1 = token("a1.csv", &["--columns", "email", "--dataset", "customers"]);
    let a2 = token("a2.csv", &["--columns", "email", "--dataset", "customers"]);
    let b = token("b.csv", &["--columns", "email", "--dataset", "staff"]);
    assert_ne!(a1, v1, "--dataset must not collide with v1 keys");
    assert_eq!(a1, a2, "same dataset reproduces tokens");
    assert_ne!(a1, b, "different datasets are unlinkable");
}

#[test]
fn passphrase_session_reproduces_and_stays_off_master_key_path() {
    let d = tmpdir("passphrase");
    fs::write(d.join("in.csv"), "email\nj@s.io\n").unwrap();
    write_key(&d.join("key.bin"), &[1u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();

    let run = |outfile: &str, extra: Vec<String>| {
        let out = bin()
            .arg("anonymise")
            .arg(d.join("in.csv"))
            .arg(d.join(outfile))
            .args(&extra)
            .env("RUST_BACKTRACE", "0")
            .output()
            .unwrap();
        assert!(out.status.success());
        (
            fs::read_to_string(d.join(outfile))
                .unwrap()
                .lines()
                .nth(1)
                .unwrap()
                .to_string(),
            String::from_utf8_lossy(&out.stdout).to_string(),
        )
    };

    let mk = |keyed: bool| -> Vec<String> {
        let mut a = vec![
            "--salt-file".to_string(),
            d.join("salt.bin").display().to_string(),
            "--columns".to_string(),
            "email".to_string(),
        ];
        if keyed {
            a.extend([
                "--master-key-file".to_string(),
                d.join("key.bin").display().to_string(),
            ]);
        } else {
            a.extend([
                "--passphrase".to_string(),
                "hunter2".to_string(),
                "--argon2-iters".to_string(),
                "1".to_string(),
                "--argon2-memory-kb".to_string(),
                "8".to_string(),
            ]);
        }
        a
    };
    let (p1, out1) = run("p1.csv", mk(false));
    let (p2, _) = run("p2.csv", mk(false));
    let (m, outm) = run("m.csv", mk(true));
    assert_eq!(p1, p2, "same passphrase + salt reproduces tokens");
    assert_ne!(p1, m, "passphrase path is domain-separated from raw keys");
    assert!(
        out1.contains("Argon2id(passphrase)"),
        "summary states the schedule: {out1}"
    );
    assert!(
        outm.contains("Key fingerprint: "),
        "master-key run prints its fingerprint: {outm}"
    );
    assert!(
        !out1.contains("Key fingerprint"),
        "passphrase fingerprint would be a guessing oracle: {out1}"
    );
}

#[test]
fn argon2_flags_require_passphrase() {
    let d = tmpdir("argon-gate");
    fs::write(d.join("in.csv"), "email\nj@s.io\n").unwrap();
    write_key(&d.join("key.bin"), &[1u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();

    let out = run_cli(
        &d,
        "in.csv",
        &[
            fast_key_args(&d),
            svec(["--columns", "email", "--argon2-iters", "1"]),
        ]
        .concat(),
    );
    assert!(
        !out.status.success(),
        "argon2 overrides exist only for the passphrase path"
    );
}

#[test]
fn failed_run_leaves_no_part_file() {
    let d = tmpdir("no-stale-part");
    fs::write(d.join("in.csv"), "name,email\nJohn,j@s.io\n").unwrap();
    write_key(&d.join("key.bin"), &[1u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();

    let out = run_cli(
        &d,
        "in.csv",
        &[fast_key_args(&d), svec(["--columns", "emial"])].concat(),
    );
    assert!(!out.status.success(), "missing column must abort");
    assert!(!d.join("out.csv").exists());
    assert!(
        !d.join("out.csv.part").exists(),
        "stale .part left after missing-column failure"
    );

    fs::write(d.join("ragged.csv"), "name,email\nJohn,j@s.io\nonlyone\n").unwrap();
    let out = run_cli(
        &d,
        "ragged.csv",
        &[fast_key_args(&d), svec(["--columns", "email"])].concat(),
    );
    assert!(!out.status.success(), "ragged row must abort");
    assert!(!d.join("out.csv").exists());
    assert!(
        !d.join("out.csv.part").exists(),
        "stale .part left after mid-stream failure"
    );

    let out = run_cli(
        &d,
        "in.csv",
        &[fast_key_args(&d), svec(["--columns", "email"])].concat(),
    );
    assert!(out.status.success());
    assert!(d.join("out.csv").exists());
    assert!(!d.join("out.csv.part").exists());
}

#[cfg(unix)]
#[test]
fn part_temp_symlink_is_not_followed() {
    use crate::common::{fast_key_args, run_cli, tmpdir, write_key};
    let d = tmpdir("part-symlink");
    std::fs::write(d.join("in.csv"), "a,b\n1,2\n").unwrap();
    write_key(&d.join("key.bin"), &[5u8; 64]);
    std::fs::write(d.join("salt.bin"), [2u8; 32]).unwrap();
    std::fs::write(d.join("victim.txt"), "precious").unwrap();
    std::os::unix::fs::symlink(d.join("victim.txt"), d.join("out.csv.part")).unwrap();
    let mut args = fast_key_args(&d);
    args.extend(["--columns".to_string(), "a".to_string()]);
    let o = run_cli(&d, "in.csv", &args);
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    assert_eq!(std::fs::read(d.join("victim.txt")).unwrap(), b"precious");
    assert!(d.join("out.csv").exists());
}
