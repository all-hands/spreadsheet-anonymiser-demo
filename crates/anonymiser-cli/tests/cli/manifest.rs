use crate::common::{bin, fast_key_args, run_cli, svec, tmpdir, write_key, TestDir};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

const INPUT: &str = "id,email,amount\n1,alice@example.org,9\n2,bob@example.org,8\n";

fn pp_args(d: &Path, extra: &[&str]) -> Vec<String> {
    let mut a = svec(["--passphrase", "hunter2", "--columns", "email"]);
    a.extend([
        "--salt-file".into(),
        d.join("salt.bin").display().to_string(),
    ]);
    if !extra
        .iter()
        .any(|e| e.starts_with("--argon2-iters") || *e == "--preset")
    {
        a.extend(svec(["--argon2-iters", "1", "--argon2-memory-kb", "8"]));
    }
    a.extend(extra.iter().map(|s| s.to_string()));
    a
}

fn setup(tag: &str) -> TestDir {
    let d = tmpdir(tag);
    fs::write(d.join("in.csv"), INPUT).unwrap();
    d
}

fn manifest(d: &Path, out: &str) -> serde_json::Value {
    let raw = fs::read_to_string(d.join(format!("{out}.manifest.json"))).unwrap();
    serde_json::from_str(&raw).unwrap()
}

fn stderr(o: &std::process::Output) -> String {
    String::from_utf8_lossy(&o.stderr).to_string()
}

fn stdout(o: &std::process::Output) -> String {
    String::from_utf8_lossy(&o.stdout).to_string()
}

fn sha(p: &Path) -> String {
    hex::encode(Sha256::digest(fs::read(p).unwrap()))
}

#[test]
fn manifest_records_settings_hashes_and_no_secrets() {
    let d = setup("manifest-basic");
    write_key(&d.join("key.bin"), &[5u8; 64]);
    let mut args = fast_key_args(&d);
    args.extend(svec([
        "--columns",
        "email:email",
        "--dataset",
        "customers",
        "--token-bytes",
        "8",
        "--token-encoding",
        "base32",
    ]));
    let o = run_cli(&d, "in.csv", &args);
    assert!(o.status.success(), "{}", stderr(&o));

    let m = manifest(&d, "out.csv");
    assert_eq!(m["kind"], "anonymiser-manifest");
    assert_eq!(m["schema_version"], 1);
    assert_eq!(m["tool_version"], env!("CARGO_PKG_VERSION"));
    assert!(m["created_utc"].as_str().unwrap().ends_with('Z'));
    assert_eq!(m["dataset"], "customers");
    assert_eq!(m["oneshot"], false);
    assert_eq!(m["reversible"], false);
    assert_eq!(m["key_schedule"]["kdf"], "hkdf-sha512");
    assert!(m["key_schedule"]["argon2id"].is_null());
    assert_eq!(m["key_schedule"]["key_id"].as_str().unwrap().len(), 16);
    assert_eq!(m["tokens"]["encoding"], "base32");
    assert_eq!(m["tokens"]["bytes"], 8);
    assert_eq!(m["salt"]["format"], "anonsalt-v1");
    assert_eq!(m["input"]["name"], "in.csv");
    assert_eq!(m["input"]["rows"], 2);
    assert_eq!(m["input"]["sha256"], sha(&d.join("in.csv")));
    assert_eq!(m["output"]["sha256"], sha(&d.join("out.csv")));
    let cols = m["columns"].as_array().unwrap();
    assert_eq!(cols.len(), 3);
    assert_eq!(cols[1]["name"], "email");
    assert_eq!(cols[1]["policy"], "hash");
    assert_eq!(cols[1]["canon"], "email");
    assert_eq!(cols[2]["policy"], "keep");

    let raw = fs::read_to_string(d.join("out.csv.manifest.json")).unwrap();
    let salt = fs::read(d.join("salt.bin")).unwrap();
    assert_eq!(m["salt"]["id"].as_str().unwrap().len(), 16);
    for secret in [
        hex::encode(&salt[9..41]),
        hex::encode([5u8; 64]),
        "alice".to_string(),
        "bob@".to_string(),
    ] {
        assert!(!raw.contains(&secret), "manifest leaks {secret}");
    }
    assert!(stdout(&o).contains("Manifest: "));
}

#[cfg(unix)]
#[test]
fn salt_and_manifest_files_are_0600() {
    use std::os::unix::fs::PermissionsExt;
    let d = setup("manifest-modes");
    let o = run_cli(&d, "in.csv", &pp_args(&d, &[]));
    assert!(o.status.success(), "{}", stderr(&o));
    for f in ["salt.bin", "out.csv.manifest.json"] {
        let mode = fs::metadata(d.join(f)).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "{f}");
    }
    assert!(!d.join("out.csv.manifest.json.part").exists());
}

#[test]
fn salt_file_pins_the_argon2_cost_and_fails_closed_on_change() {
    let d = setup("kdf-pin");
    let o = run_cli(&d, "in.csv", &pp_args(&d, &[]));
    assert!(o.status.success(), "{}", stderr(&o));
    let salt_bytes = fs::read(d.join("salt.bin")).unwrap();
    assert!(salt_bytes.starts_with(b"ANONSALT"));
    assert_eq!(
        salt_bytes.len(),
        58,
        "magic+ver+salt+kdf+12 param bytes+crc"
    );
    let first = fs::read_to_string(d.join("out.csv")).unwrap();
    let m = manifest(&d, "out.csv");
    assert_eq!(m["key_schedule"]["kdf"], "argon2id");
    assert_eq!(m["key_schedule"]["argon2id"]["iters"], 1);
    assert_eq!(m["key_schedule"]["argon2id"]["memory_kb"], 8);
    assert!(
        m["key_schedule"]["key_id"].is_null(),
        "no passphrase oracle"
    );

    let mut again = pp_args(&d, &[]);
    again.push("--force".into());
    assert!(run_cli(&d, "in.csv", &again).status.success());
    assert_eq!(fs::read_to_string(d.join("out.csv")).unwrap(), first);

    write_key(&d.join("key.bin"), &[1u8; 64]);
    let mut master = fast_key_args(&d);
    master.extend(svec(["--columns", "email", "--force"]));
    let variants: Vec<Vec<String>> = vec![
        pp_args(
            &d,
            &["--argon2-iters", "2", "--argon2-memory-kb", "8", "--force"],
        ),
        pp_args(&d, &["--preset", "cli", "--force"]),
        master,
    ];
    for args in variants {
        let o = run_cli(&d, "in.csv", &args);
        assert!(!o.status.success(), "must fail closed: {args:?}");
        assert!(stderr(&o).contains("records argon2id"), "{}", stderr(&o));
        assert!(stderr(&o).contains("new --salt-file"), "{}", stderr(&o));
    }
    assert_eq!(fs::read_to_string(d.join("out.csv")).unwrap(), first);
    assert_eq!(fs::read(d.join("salt.bin")).unwrap(), salt_bytes);
}

#[test]
fn master_key_salt_rejects_a_later_passphrase_run() {
    let d = setup("kdf-hkdf-pin");
    write_key(&d.join("key.bin"), &[2u8; 64]);
    let mut a = fast_key_args(&d);
    a.extend(svec(["--columns", "email"]));
    assert!(run_cli(&d, "in.csv", &a).status.success());
    a.push("--force".into());
    assert!(run_cli(&d, "in.csv", &a).status.success());

    let mut p = pp_args(&d, &[]);
    p.push("--force".into());
    let o = run_cli(&d, "in.csv", &p);
    assert!(!o.status.success());
    assert!(stderr(&o).contains("records hkdf-sha512"), "{}", stderr(&o));
}

#[test]
fn legacy_raw_salt_is_accepted_warned_about_and_never_rewritten() {
    let d = setup("kdf-legacy");
    fs::write(d.join("salt.bin"), [3u8; 32]).unwrap();
    let o = run_cli(&d, "in.csv", &pp_args(&d, &[]));
    assert!(o.status.success(), "{}", stderr(&o));
    assert!(
        stderr(&o).contains("legacy raw salt file"),
        "{}",
        stderr(&o)
    );
    assert_eq!(fs::read(d.join("salt.bin")).unwrap(), vec![3u8; 32]);
    let m = manifest(&d, "out.csv");
    assert_eq!(m["salt"]["format"], "legacy-raw");
    assert_eq!(
        m["key_schedule"]["argon2id"]["memory_kb"], 8,
        "params still recorded"
    );

    write_key(&d.join("key.bin"), &[2u8; 64]);
    let mut a = fast_key_args(&d);
    a.extend(svec(["--columns", "email", "--force"]));
    let o = run_cli(&d, "in.csv", &a);
    assert!(
        o.status.success() && !stderr(&o).contains("warning"),
        "{}",
        stderr(&o)
    );
}

#[test]
fn corrupt_versioned_salt_fails_closed() {
    let d = setup("kdf-corrupt");
    assert!(run_cli(&d, "in.csv", &pp_args(&d, &[])).status.success());
    let mut b = fs::read(d.join("salt.bin")).unwrap();
    b[12] ^= 1;
    fs::write(d.join("salt.bin"), b).unwrap();
    let mut a = pp_args(&d, &[]);
    a.push("--force".into());
    let o = run_cli(&d, "in.csv", &a);
    assert!(!o.status.success());
    assert!(stderr(&o).contains("checksum mismatch"), "{}", stderr(&o));
}

#[test]
fn oneshot_manifest_has_no_salt_id_and_opt_outs_write_nothing() {
    let d = setup("manifest-oneshot");
    write_key(&d.join("key.bin"), &[2u8; 64]);
    let mk = |extra: &[&str]| {
        let mut a = svec(["--columns", "email", "--force"]);
        a.extend([
            "--master-key-file".into(),
            d.join("key.bin").display().to_string(),
        ]);
        a.extend(extra.iter().map(|s| s.to_string()));
        a
    };
    assert!(run_cli(&d, "in.csv", &mk(&["--oneshot"])).status.success());
    let m = manifest(&d, "out.csv");
    assert_eq!(m["oneshot"], true);
    assert!(m["salt"]["id"].is_null());
    assert_eq!(m["salt"]["format"], "oneshot");
    assert!(!d.join("anonymiser.salt").exists() && !d.join("salt.bin").exists());

    let _ = fs::remove_file(d.join("out.csv.manifest.json"));
    let o = run_cli(&d, "in.csv", &mk(&["--oneshot", "--no-manifest"]));
    assert!(o.status.success());
    assert!(!d.join("out.csv.manifest.json").exists());

    let o = bin()
        .arg("anonymise")
        .arg(d.join("in.csv"))
        .arg("-")
        .args(mk(&["--oneshot"]))
        .output()
        .unwrap();
    assert!(o.status.success());
    assert!(!d.join("-.manifest.json").exists());
}

#[test]
fn verify_manifest_checks_output_hash_salt_and_settings() {
    let d = setup("manifest-verify");
    write_key(&d.join("key.bin"), &[6u8; 64]);
    let mut args = fast_key_args(&d);
    args.extend(svec([
        "--columns",
        "email:email",
        "--dataset",
        "ds",
        "--token-encoding",
        "base32",
        "--token-bytes",
        "8",
    ]));
    assert!(run_cli(&d, "in.csv", &args).status.success());

    let verify = |extra: &[&str]| {
        bin()
            .arg("verify")
            .arg(d.join("out.csv"))
            .arg("--manifest")
            .arg(d.join("out.csv.manifest.json"))
            .args(extra)
            .output()
            .unwrap()
    };
    let key = d.join("key.bin").display().to_string();
    let salt = d.join("salt.bin").display().to_string();
    let orig = d.join("in.csv").display().to_string();

    let o = verify(&[
        "--master-key-file",
        &key,
        "--salt-file",
        &salt,
        "--against",
        &orig,
    ]);
    let out = stdout(&o);
    assert!(o.status.success(), "{out}{}", stderr(&o));
    for needle in [
        "output SHA-256 matches",
        "row count 2 matches",
        "salt id",
        "fingerprint",
        "re-derivation: 2 token cells match",
    ] {
        assert!(out.contains(needle), "{needle}: {out}");
    }

    let o = verify(&["--token-bytes", "16"]);
    assert!(!o.status.success());
    assert!(stdout(&o).contains("disagrees with the manifest"));

    let good = fs::read_to_string(d.join("out.csv.manifest.json")).unwrap();
    fs::write(
        d.join("out.csv.manifest.json"),
        good.replace("\"base32\"", "\"base32x\""),
    )
    .unwrap();
    let o = verify(&[]);
    assert!(!o.status.success());
    assert!(stdout(&o).contains("base32x"), "{}", stdout(&o));
    let o = verify(&["--token-encoding", "base32"]);
    assert!(!o.status.success());
    assert!(!stdout(&o).contains("matches the manifest (base32"));
    fs::write(d.join("out.csv.manifest.json"), good).unwrap();

    fs::write(d.join("other.salt"), [9u8; 32]).unwrap();
    let o = verify(&["--salt-file", &d.join("other.salt").display().to_string()]);
    assert!(!o.status.success());
    assert!(stdout(&o).contains("--salt-file has id"));

    let mut tampered = fs::read_to_string(d.join("out.csv")).unwrap();
    tampered.push_str("3,x,7\n");
    fs::write(d.join("out.csv"), tampered).unwrap();
    let o = verify(&[]);
    let out = stdout(&o);
    assert!(!o.status.success());
    assert!(out.contains("the file changed since the run"), "{out}");
    assert!(out.contains("the manifest recorded 2"), "{out}");
}

#[test]
fn verify_rejects_a_non_manifest_file() {
    let d = setup("manifest-bad");
    fs::write(d.join("m.json"), r#"{"kind":"other","schema_version":1}"#).unwrap();
    let o = bin()
        .arg("verify")
        .arg(d.join("in.csv"))
        .arg("--manifest")
        .arg(d.join("m.json"))
        .output()
        .unwrap();
    assert!(!o.status.success());
}
