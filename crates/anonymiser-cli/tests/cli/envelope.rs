use crate::common::{bin, tmpdir};
use std::fs;

#[test]
fn keygen_creates_envelope_and_guards_overwrite() {
    let d = tmpdir("keygen");

    let out = bin()
        .arg("keygen")
        .arg("--out")
        .arg(d.join("k.bin"))
        .env("RUST_BACKTRACE", "0")
        .output()
        .unwrap();
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("Key id: "), "got: {stdout}");
    let env = fs::read(d.join("k.bin")).unwrap();
    assert_eq!(env.len(), anonymiser_core::KEY_FILE_LEN);
    assert!(env.starts_with(&anonymiser_core::KEY_MAGIC));
    assert!(anonymiser_core::parse_master_key(&env).is_ok());

    let again = bin()
        .arg("keygen")
        .arg("--out")
        .arg(d.join("k.bin"))
        .output()
        .unwrap();
    assert!(!again.status.success());
    assert!(String::from_utf8_lossy(&again.stderr).contains("--force"));
    let forced = bin()
        .args(["keygen", "--force", "--out"])
        .arg(d.join("k.bin"))
        .output()
        .unwrap();
    assert!(forced.status.success());

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(d.join("k.bin")).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "key file must be owner-only");
    }
}

#[test]
fn wrong_key_file_fails_closed_and_legacy_upgrade_preserves_tokens() {
    let d = tmpdir("envelope-fail-closed");
    fs::write(d.join("in.csv"), "name\nJohn Smith\n").unwrap();
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();

    let run = |keyfile: &str, outfile: &str, extra: &[&str]| -> std::process::Output {
        bin()
            .arg("anonymise")
            .arg(d.join("in.csv"))
            .arg(d.join(outfile))
            .arg("--master-key-file")
            .arg(d.join(keyfile))
            .arg("--salt-file")
            .arg(d.join("salt.bin"))
            .arg("--columns")
            .arg("name")
            .args(extra)
            .env("RUST_BACKTRACE", "0")
            .output()
            .unwrap()
    };

    let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    png.extend([7u8; 56]);
    fs::write(d.join("fake.bin"), &png).unwrap();
    let out = run("fake.bin", "fake-out.csv", &[]);
    assert!(!out.status.success(), "a wrong file is not a key");
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("fake.bin"), "error names the path: {err}");
    assert!(err.contains("keygen"), "error suggests the fix: {err}");
    assert!(!d.join("fake-out.csv").exists());

    fs::write(d.join("legacy.bin"), [7u8; 64]).unwrap();
    let deny = run("legacy.bin", "deny.csv", &[]);
    assert!(
        !deny.status.success(),
        "raw key without the flag fails closed"
    );
    let allow = run("legacy.bin", "allow.csv", &["--allow-legacy-key"]);
    assert!(allow.status.success());
    assert!(
        String::from_utf8_lossy(&allow.stderr).contains("legacy raw key"),
        "acceptance is loud"
    );
    let before = fs::read_to_string(d.join("allow.csv")).unwrap();

    let up = bin()
        .args(["keygen", "--upgrade-from"])
        .arg(d.join("legacy.bin"))
        .output()
        .unwrap();
    assert!(up.status.success());
    let stdout = String::from_utf8_lossy(&up.stdout);
    assert!(stdout.contains("key bytes unchanged"), "got: {stdout}");
    let parsed = anonymiser_core::parse_master_key(&fs::read(d.join("legacy.bin")).unwrap())
        .expect("upgraded file is a valid envelope");
    assert_eq!(parsed.key, vec![7u8; 64], "upgrade preserves key bytes");

    let after = run("legacy.bin", "after.csv", &[]);
    assert!(after.status.success(), "envelope loads without the flag");
    assert_eq!(
        fs::read_to_string(d.join("after.csv")).unwrap(),
        before,
        "upgrade must not change a single token"
    );
}

#[test]
fn upgrade_of_short_legacy_key_fails_and_leaves_file() {
    let d = tmpdir("upgrade-short");
    let p = d.join("short.bin");
    fs::write(&p, [7u8; 32]).unwrap();
    let out = bin()
        .args(["keygen", "--upgrade-from"])
        .arg(&p)
        .output()
        .unwrap();
    assert!(!out.status.success());
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("--allow-legacy-key"), "got: {err}");
    assert_eq!(fs::read(&p).unwrap(), vec![7u8; 32]);
}

#[test]
fn allow_legacy_key_rejects_magic_bearing_file() {
    let d = tmpdir("legacy-magic");
    let mut bytes = anonymiser_core::KEY_MAGIC.to_vec();
    bytes.extend([7u8; 74]);
    assert_eq!(bytes.len(), 82);
    fs::write(d.join("k.bin"), &bytes).unwrap();
    fs::write(d.join("in.csv"), "name\nAda\n").unwrap();
    let out = bin()
        .arg("anonymise")
        .arg(d.join("in.csv"))
        .arg(d.join("out.csv"))
        .arg("--master-key-file")
        .arg(d.join("k.bin"))
        .arg("--salt-file")
        .arg(d.join("salt.bin"))
        .args(["--columns", "name", "--allow-legacy-key"])
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(!d.join("out.csv").exists());
}

#[test]
fn empty_dataset_is_refused_without_output() {
    let d = tmpdir("empty-dataset");
    fs::write(d.join("in.csv"), "name\nAda\n").unwrap();
    let out = bin()
        .arg("anonymise")
        .arg(d.join("in.csv"))
        .arg(d.join("out.csv"))
        .arg("--master-key-file")
        .arg(d.join("k.bin"))
        .arg("--salt-file")
        .arg(d.join("salt.bin"))
        .args(["--columns", "name", "--dataset", ""])
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("dataset namespace must not be empty"));
    assert!(!d.join("out.csv").exists());
}

#[test]
fn empty_dataset_from_profile_is_refused_without_output() {
    let d = tmpdir("empty-dataset-profile");
    fs::write(d.join("in.csv"), "name\nAda\n").unwrap();
    fs::write(d.join("p.toml"), "columns = \"name\"\ndataset = \"\"\n").unwrap();
    let out = bin()
        .arg("anonymise")
        .arg(d.join("in.csv"))
        .arg(d.join("out.csv"))
        .arg("--master-key-file")
        .arg(d.join("k.bin"))
        .arg("--salt-file")
        .arg(d.join("salt.bin"))
        .arg("--profile")
        .arg(d.join("p.toml"))
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("dataset namespace must not be empty"));
    assert!(!d.join("out.csv").exists());
    assert!(
        !d.join("k.bin").exists(),
        "no key minted before the refusal"
    );
}

#[test]
fn empty_dataset_is_refused_by_verify_and_inspect() {
    let d = tmpdir("empty-dataset-verify-inspect");
    fs::write(d.join("in.csv"), "name\nAda\n").unwrap();
    for cmd in ["verify", "inspect"] {
        let out = bin()
            .arg(cmd)
            .arg(d.join("in.csv"))
            .args(["--columns", "name", "--dataset", ""])
            .output()
            .unwrap();
        assert!(!out.status.success(), "{cmd} accepted an empty dataset");
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(
            stderr.contains("dataset namespace must not be empty"),
            "{cmd}: {stderr}"
        );
    }
}
