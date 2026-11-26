use crate::common::{bin, fast_key_args, run_cli, svec, tmpdir, write_key};
use std::fs;

#[test]
fn keyed_hash_is_pinned_and_columns_pass_through() {
    let d = tmpdir("pinned");

    let input = d.join("in.csv");
    let output = d.join("out.csv");
    let key = d.join("key.bin");
    let salt = d.join("salt.bin");
    fs::write(&input, "name,email,note\nJohn Smith,j@s.io,keep me\n").unwrap();
    write_key(&key, &[7u8; 64]);
    fs::write(&salt, [1u8; 32]).unwrap();

    let status = bin()
        .args([
            "anonymise",
            input.to_str().unwrap(),
            output.to_str().unwrap(),
            "--columns",
            "name,email",
            "--policy",
            "hash",
            "--master-key-file",
            key.to_str().unwrap(),
            "--salt-file",
            salt.to_str().unwrap(),
        ])
        .status()
        .unwrap();
    assert!(status.success());

    let out = fs::read_to_string(&output).unwrap();
    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(lines[0], "name,email,note");
    let row: Vec<&str> = lines[1].split(',').collect();
    assert_eq!(
        row[0], "4dc4893f2de3c94d9944266e8a146555",
        "keyed hash of canonicalized 'john smith' under column 'name' \
         (16-byte truncated BLAKE2b-512 MAC)"
    );
    assert_eq!(row[1].len(), 32, "email column is keyed too");
}

#[test]
fn token_bytes_flag_truncates_and_stays_deterministic() {
    let d = tmpdir("token-bytes");
    fs::write(d.join("in.csv"), "name\nJohn Smith\n").unwrap();
    write_key(&d.join("key.bin"), &[7u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();

    let token = |tb: &'static str| {
        let _ = fs::remove_file(d.join("out.csv"));
        let out = run_cli(
            &d,
            "in.csv",
            &[
                fast_key_args(&d),
                svec(["--columns", "name", "--token-bytes", tb]),
            ]
            .concat(),
        );
        assert!(out.status.success());
        fs::read_to_string(d.join("out.csv"))
            .unwrap()
            .lines()
            .nth(1)
            .unwrap()
            .to_string()
    };

    let full = token("16");
    let short = token("8");
    assert_eq!(full.len(), 32, "16 bytes ⇒ 32 hex chars: {full}");
    assert_eq!(short.len(), 16, "8 bytes ⇒ 16 hex chars: {short}");
    assert!(
        full.starts_with(&short),
        "shorter token is a prefix — raising token_bytes never breaks joins"
    );
    let _ = fs::remove_file(d.join("out.csv"));

    let bad = run_cli(
        &d,
        "in.csv",
        &[
            fast_key_args(&d),
            svec(["--columns", "name", "--token-bytes", "0"]),
        ]
        .concat(),
    );
    assert!(!bad.status.success(), "0-byte tokens must be rejected");
}

#[test]
fn mask_policy_and_salt_reuse_reproduce_output() {
    let d = tmpdir("mask");

    let input = d.join("in.csv");
    let key = d.join("key.bin");
    let salt = d.join("salt.bin");
    fs::write(&input, "contact\nalice@example.com\n").unwrap();
    write_key(&key, &[9u8; 64]);
    fs::write(&salt, [3u8; 32]).unwrap();

    for out in ["out1.csv", "out2.csv"] {
        let status = bin()
            .args([
                "anonymise",
                input.to_str().unwrap(),
                d.join(out).to_str().unwrap(),
                "--columns",
                "contact",
                "--policy",
                "mask",
                "--master-key-file",
                key.to_str().unwrap(),
                "--salt-file",
                salt.to_str().unwrap(),
            ])
            .status()
            .unwrap();
        assert!(status.success());
    }

    let out1 = fs::read_to_string(d.join("out1.csv")).unwrap();
    let out2 = fs::read_to_string(d.join("out2.csv")).unwrap();
    assert_eq!(out1, out2, "same key+salt => byte-identical output");
    assert!(out1.contains("a****@example.com"), "got: {out1}");
}

#[test]
fn encrypt_then_decrypt_roundtrips() {
    let d = tmpdir("encrypt");

    let input = d.join("in.csv");
    let enc_out = d.join("enc.csv");
    let dec_out = d.join("dec.csv");
    let key = d.join("key.bin");
    let salt = d.join("salt.bin");
    fs::write(&input, "name,note\nAlice Smith,visible\n").unwrap();
    write_key(&key, &[2u8; 64]);
    fs::write(&salt, [4u8; 32]).unwrap();

    let run = |infile: &std::path::Path, outfile: &std::path::Path, extra: &[&str]| {
        let mut cmd = bin();
        cmd.args([
            "anonymise",
            infile.to_str().unwrap(),
            outfile.to_str().unwrap(),
            "--columns",
            "name",
            "--master-key-file",
            key.to_str().unwrap(),
            "--salt-file",
            salt.to_str().unwrap(),
        ])
        .args(extra);
        assert!(cmd.status().unwrap().success());
    };

    run(&input, &enc_out, &["--policy", "encrypt"]);
    run(&enc_out, &dec_out, &["--decrypt"]);

    let encrypted = fs::read_to_string(&enc_out).unwrap();
    assert!(encrypted.contains("enc:v1:"), "got: {encrypted}");
    assert!(
        encrypted.contains("visible"),
        "untouched columns pass through"
    );

    let decrypted = fs::read_to_string(&dec_out).unwrap();
    assert!(decrypted.contains("Alice Smith"), "got: {decrypted}");
}

#[test]
fn legacy_policies_produce_legacy_formats() {
    let d = tmpdir("legacy");

    let input = d.join("in.csv");
    let output = d.join("out.csv");
    let key = d.join("key.bin");
    let salt = d.join("salt.bin");
    fs::write(&input, "name,phone\nJohn Doe,07700900456\n").unwrap();
    write_key(&key, &[9u8; 64]);
    fs::write(&salt, [1u8; 32]).unwrap();

    let policy = d.join("policy.json");
    fs::write(
        &policy,
        r#"{"version":1,"columns":[
            {"name":"name","action":"legacy-hmac-sha256"},
            {"name":"phone","action":"legacy-mask"}
        ]}"#,
    )
    .unwrap();

    let status = bin()
        .args([
            "anonymise",
            input.to_str().unwrap(),
            output.to_str().unwrap(),
            "--policy-file",
            policy.to_str().unwrap(),
            "--master-key-file",
            key.to_str().unwrap(),
            "--legacy-key",
            "old-global-key",
        ])
        .status()
        .unwrap();
    assert!(status.success());

    let out = fs::read_to_string(&output).unwrap();
    let row: Vec<&str> = out.lines().nth(1).unwrap().split(',').collect();
    assert_eq!(row[0].len(), 16, "got: {out}");
    assert_eq!(row[1], "0*********6", "old whole-cell mask, got: {out}");

    let output2 = d.join("out2.csv");
    fs::write(
        &policy,
        r#"{"version":1,"columns":[{"index":0,"action":"legacy-hmac-sha256"}]}"#,
    )
    .unwrap();
    let status = bin()
        .args([
            "anonymise",
            input.to_str().unwrap(),
            output2.to_str().unwrap(),
            "--policy-file",
            policy.to_str().unwrap(),
            "--master-key-file",
            key.to_str().unwrap(),
            "--legacy-key",
            "old-global-key",
        ])
        .status()
        .unwrap();
    assert!(status.success());
    let out2 = fs::read_to_string(&output2).unwrap();
    let row2: Vec<&str> = out2.lines().nth(1).unwrap().split(',').collect();
    assert_eq!(row2[0], "72ef6c751e84f1c6", "legacy hmac vector");
}

#[test]
fn legacy_encryption_roundtrip_via_policy_file_and_decrypt() {
    let d = tmpdir("legacy-enc");

    let input = d.join("in.csv");
    let enc_out = d.join("enc.csv");
    let qenc_out = d.join("qenc.csv");
    let dec1 = d.join("dec1.csv");
    let dec2 = d.join("dec2.csv");
    let key = d.join("key.bin");
    let salt = d.join("salt.bin");
    fs::write(&input, "name,note\nAlice Smith,visible\n").unwrap();
    write_key(&key, &[9u8; 64]);
    fs::write(&salt, [1u8; 32]).unwrap();

    let policy = d.join("policy.json");
    let run = |outfile: &std::path::Path, action: &str| {
        fs::write(
            &policy,
            format!(r#"{{"version":1,"columns":[{{"name":"name","action":"{action}"}}]}}"#),
        )
        .unwrap();
        let status = bin()
            .args([
                "anonymise",
                input.to_str().unwrap(),
                outfile.to_str().unwrap(),
                "--policy-file",
                policy.to_str().unwrap(),
                "--master-key-file",
                key.to_str().unwrap(),
                "--salt-file",
                salt.to_str().unwrap(),
                "--legacy-key",
                "old-global-key",
            ])
            .status()
            .unwrap();
        assert!(status.success());
    };

    run(&enc_out, "legacy-aes");
    let enc = fs::read_to_string(&enc_out).unwrap();
    assert!(enc.contains("enc:"), "got: {enc}");

    run(&qenc_out, "legacy-kyber-aes");
    let qenc = fs::read_to_string(&qenc_out).unwrap();
    assert!(qenc.contains("qenc:"), "got: {qenc}");

    for (src, dst) in [(&enc_out, &dec1), (&qenc_out, &dec2)] {
        let status = bin()
            .args([
                "anonymise",
                src.to_str().unwrap(),
                dst.to_str().unwrap(),
                "--decrypt",
                "--master-key-file",
                key.to_str().unwrap(),
                "--salt-file",
                salt.to_str().unwrap(),
                "--legacy-key",
                "old-global-key",
            ])
            .status()
            .unwrap();
        assert!(status.success());
        let out = fs::read_to_string(dst).unwrap();
        assert!(out.contains("Alice Smith"), "got: {out}");
    }
}
