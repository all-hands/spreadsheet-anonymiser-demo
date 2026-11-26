use crate::common::{bin, fast_key_args, run_cli, svec, tmpdir, write_key};
use std::fs;

#[test]
fn tsv_jsonl_and_stdio_round_trip() {
    let d = tmpdir("formats");
    write_key(&d.join("key.bin"), &[3u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();

    fs::write(d.join("in.tsv"), "name\tnote\nJohn Smith\tkeep\n").unwrap();
    fs::write(d.join("in.csv"), "name,note\nJohn Smith,keep\n").unwrap();
    let tsv = run_cli(
        &d,
        "in.tsv",
        &[fast_key_args(&d), svec(["--columns", "name"])].concat(),
    );
    assert!(
        tsv.status.success(),
        "{}",
        String::from_utf8_lossy(&tsv.stderr)
    );
    let tsv_out = fs::read_to_string(d.join("out.csv")).unwrap();
    assert!(tsv_out.contains('\t'), "stays tab-separated: {tsv_out:?}");
    fs::remove_file(d.join("out.csv")).unwrap();
    let csv = run_cli(
        &d,
        "in.csv",
        &[fast_key_args(&d), svec(["--columns", "name"])].concat(),
    );
    assert!(csv.status.success());
    let csv_out = fs::read_to_string(d.join("out.csv")).unwrap();
    let tsv_token = tsv_out.lines().nth(1).unwrap().split('\t').next().unwrap();
    let csv_token = csv_out.lines().nth(1).unwrap().split(',').next().unwrap();
    assert_eq!(tsv_token, csv_token, "format must not change tokens");

    fs::write(
        d.join("in.jsonl"),
        "{\"email\":\"a@b.com\",\"amount\":9.8}\n{\"email\":\"c@d.io\",\"amount\":7.5}\n",
    )
    .unwrap();
    fs::remove_file(d.join("out.csv")).unwrap();
    let jsonl = run_cli(
        &d,
        "in.jsonl",
        &[fast_key_args(&d), svec(["--columns", "email"])].concat(),
    );
    assert!(
        jsonl.status.success(),
        "{}",
        String::from_utf8_lossy(&jsonl.stderr)
    );
    let jl_out = fs::read_to_string(d.join("out.csv")).unwrap();
    let lines: Vec<&str> = jl_out.lines().collect();
    assert_eq!(lines.len(), 2, "one JSON object per line: {jl_out:?}");
    let obj: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
    assert_eq!(
        obj["amount"],
        serde_json::json!("9.8"),
        "scalars stringify: {}",
        lines[0]
    );
    assert_eq!(
        obj["email"].as_str().unwrap().len(),
        32,
        "tokenised: {}",
        lines[0]
    );

    fs::write(
        d.join("bad.jsonl"),
        "{\"email\":\"a@b.com\"}\n{\"email\":\"c@d.io\",\"extra\":1}\n",
    )
    .unwrap();
    fs::remove_file(d.join("out.csv")).unwrap();
    let bad = run_cli(
        &d,
        "bad.jsonl",
        &[fast_key_args(&d), svec(["--columns", "email"])].concat(),
    );
    assert!(!bad.status.success(), "unknown keys must fail closed");
    assert!(String::from_utf8_lossy(&bad.stderr).contains("extra"));

    use std::io::Write as _;
    let mut child = bin()
        .args(["anonymise", "-", "-"])
        .args(fast_key_args(&d))
        .arg("--columns")
        .arg("name")
        .env("RUST_BACKTRACE", "0")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(b"name,note\nJohn Smith,keep\n")
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.starts_with("name,note\n"),
        "stdout is the CSV: {stdout}"
    );
    assert!(
        stdout.contains(csv_token),
        "stdio run matches file run: {stdout}"
    );
}

#[test]
fn oneshot_runs_are_ephemeral_and_unlinkable() {
    let d = tmpdir("oneshot");
    fs::write(d.join("in.csv"), "email\na@b.com\n").unwrap();
    write_key(&d.join("key.bin"), &[1u8; 64]);

    let token = |n: usize| {
        let outfile = d.join(format!("out-{n}.csv"));
        let out = bin()
            .args(["anonymise"])
            .arg(d.join("in.csv"))
            .arg(&outfile)
            .arg("--master-key-file")
            .arg(d.join("key.bin"))
            .arg("--oneshot")
            .arg("--columns")
            .arg("email")
            .env("RUST_BACKTRACE", "0")
            .output()
            .unwrap();
        assert!(out.status.success());
        let stdout = String::from_utf8_lossy(&out.stdout);
        assert!(
            stdout.contains("one-shot (ephemeral, never persisted)"),
            "summary states the ephemeral salt: {stdout}"
        );
        fs::read_to_string(&outfile)
            .unwrap()
            .lines()
            .nth(1)
            .unwrap()
            .to_string()
    };
    let t1 = token(1);
    let t2 = token(2);
    assert_ne!(t1, t2, "two --oneshot runs must never join");
    assert!(
        !d.join("anonymiser.salt").exists(),
        "one-shot runs must not persist a salt file"
    );

    let both = bin()
        .args(["anonymise"])
        .arg(d.join("in.csv"))
        .arg(d.join("both.csv"))
        .arg("--master-key-file")
        .arg(d.join("key.bin"))
        .arg("--oneshot")
        .arg("--salt-file")
        .arg(d.join("s.bin"))
        .arg("--columns")
        .arg("email")
        .output()
        .unwrap();
    assert!(!both.status.success(), "conflicting scopes must abort");
}

#[test]
fn codec_edge_cases() {
    let d = tmpdir("codec-edges");
    write_key(&d.join("key.bin"), &[3u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();
    let args = [fast_key_args(&d), svec(["--columns", "0"])].concat();

    let bad: [(&str, &[u8]); 5] = [
        ("ragged.csv", b"a,b\nSECRET,2,3\n"),
        ("short.tsv", b"a\tb\nSECRET\n"),
        ("latin1.csv", b"a,b\n1,caf\xe9 SECRET\n"),
        ("bom.jsonl", "\u{feff}{\"a\":\"SECRET\"}\n".as_bytes()),
        ("nested.jsonl", b"{\"a\":1}\n{\"a\":[\"SECRET\"]}\n"),
    ];
    for (name, bytes) in bad {
        fs::write(d.join(name), bytes).unwrap();
        let out = run_cli(&d, name, &args);
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(!out.status.success(), "{name} must fail: {stderr}");
        assert!(!stderr.contains("SECRET"), "{name} echoed data: {stderr}");
        assert!(!d.join("out.csv").exists(), "{name} left an output");
        assert!(!d.join("out.csv.part").exists(), "{name} left a .part");
    }

    fs::write(
        d.join("blank.jsonl"),
        "{\"a\":\"x\"}\n\u{feff}\n\u{a0}\n\u{85}\n\n{\"a\":\"y\"}\n",
    )
    .unwrap();
    let out = run_cli(&d, "blank.jsonl", &args);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        fs::read_to_string(d.join("out.csv"))
            .unwrap()
            .lines()
            .count(),
        2
    );
}
