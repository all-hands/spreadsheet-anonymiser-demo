use crate::common::{bin, fast_key_args, run_cli, svec, tmpdir, write_key};
use std::fs;

#[test]
fn typed_canonicalization_is_declared_per_column() {
    let d = tmpdir("typed-canon");
    fs::write(
        d.join("in.csv"),
        "id,email,when\nAB12,a@B.com,2026-07-08\nab12,x+y@GMAIL.com,123-45\n",
    )
    .unwrap();
    write_key(&d.join("key.bin"), &[2u8; 64]);
    fs::write(d.join("salt.bin"), [1u8; 32]).unwrap();

    let out = run_cli(
        &d,
        "in.csv",
        &[
            fast_key_args(&d),
            svec(["--columns", "id:id,email:email,when:text"]),
        ]
        .concat(),
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("0:id=hash:id 1:email=hash:email 2:when=hash:text"),
        "summary states the declared types: {stdout}"
    );
    let written = fs::read_to_string(d.join("out.csv")).unwrap();
    let rows: Vec<Vec<&str>> = written
        .lines()
        .skip(1)
        .map(|l| l.split(',').collect())
        .collect();
    assert_ne!(rows[0][0], rows[1][0], "id:type must not merge by case");
    assert_ne!(rows[0][1], rows[1][1]);
    assert_ne!(rows[0][2], rows[1][2]);

    fs::write(d.join("c2.csv"), "v\n12 345\n123-45\n").unwrap();
    let _ = fs::remove_file(d.join("out.csv"));
    let auto = run_cli(
        &d,
        "c2.csv",
        &[fast_key_args(&d), svec(["--columns", "v"])].concat(),
    );
    assert!(auto.status.success());
    let auto_written = fs::read_to_string(d.join("out.csv")).unwrap();
    let a: Vec<&str> = auto_written.lines().skip(1).collect();
    assert_eq!(a[0], a[1], "Auto chain phone-guesses: 12 345 ≡ 123-45");
    let _ = fs::remove_file(d.join("out.csv"));
    let text = run_cli(
        &d,
        "c2.csv",
        &[fast_key_args(&d), svec(["--columns", "v:text"])].concat(),
    );
    assert!(text.status.success());
    let text_written = fs::read_to_string(d.join("out.csv")).unwrap();
    let t: Vec<&str> = text_written.lines().skip(1).collect();
    assert_ne!(t[0], t[1], "type=text must not phone-normalise");

    let _ = fs::remove_file(d.join("out.csv"));
    let bad = run_cli(
        &d,
        "in.csv",
        &[fast_key_args(&d), svec(["--columns", "id:wat"])].concat(),
    );
    assert!(!bad.status.success(), "unknown :type must abort");
    assert!(String::from_utf8_lossy(&bad.stderr).contains("unknown canon type"));

    fs::write(
        d.join("policy.json"),
        r#"{"version":1,"columns":[
            {"name":"email","action":"hash","type":"email"}]}"#,
    )
    .unwrap();
    let _ = fs::remove_file(d.join("out.csv"));
    let mut args = fast_key_args(&d);
    args.push("--policy-file".into());
    args.push(d.join("policy.json").display().to_string());
    let out = run_cli(&d, "in.csv", &args);
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("1:email=hash:email"),
        "policy-file type shows in the plan: {stdout}"
    );
}

#[test]
fn reversible_mode_seals_and_depseudo_reverses() {
    let d = tmpdir("reversible");
    fs::write(
        d.join("in.csv"),
        "email,note\nA@B.com,keep\nx@Y.z,keep\na@b.com,keep\n",
    )
    .unwrap();
    write_key(&d.join("key.bin"), &[5u8; 64]);
    fs::write(d.join("salt.bin"), [2u8; 32]).unwrap();

    for extra in [
        vec!["--reversible".to_string()],
        svec(["--oneshot", "--reversible", "--dataset", "customers"]),
    ] {
        let out = run_cli(&d, "in.csv", &[fast_key_args(&d), extra].concat());
        assert!(
            !out.status.success(),
            "clap must reject invalid --reversible combos"
        );
    }

    let out = run_cli(
        &d,
        "in.csv",
        &[
            fast_key_args(&d),
            vec![
                "--dataset".into(),
                "customers".into(),
                "--reversible".into(),
                "--mapping-file".into(),
                d.join("customers.mapping").display().to_string(),
                "--columns".into(),
                "email:email".into(),
            ],
        ]
        .concat(),
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success(), "{stdout}");
    assert!(
        stdout.contains("Mapping sidecar"),
        "summary must name the sidecar: {stdout}"
    );

    let mapping = d.join("customers.mapping");
    assert!(mapping.exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&mapping).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "mapping sidecar must be 0600");
    }
    let mapping_txt = fs::read_to_string(&mapping).unwrap();
    let lines: Vec<&str> = mapping_txt.lines().collect();
    assert!(lines[0].contains("\"dataset\":\"customers\""));
    assert_eq!(lines.len(), 3, "dedupe by token: {mapping_txt}");
    assert!(!mapping_txt.to_lowercase().contains("a@b.com"));

    let written = fs::read_to_string(d.join("out.csv")).unwrap();
    let tokens: Vec<String> = written
        .lines()
        .skip(1)
        .map(|l| l.split(',').next().unwrap().to_string())
        .collect();
    assert_eq!(tokens.len(), 3);
    assert_eq!(tokens[0], tokens[2], "same value → same token");

    let dep = bin()
        .args([
            "depseudo",
            mapping.to_str().unwrap(),
            "--master-key-file",
            d.join("key.bin").to_str().unwrap(),
            "--salt-file",
            d.join("salt.bin").to_str().unwrap(),
        ])
        .args([&tokens[0], &tokens[1]])
        .output()
        .unwrap();
    assert!(
        dep.status.success(),
        "{}",
        String::from_utf8_lossy(&dep.stderr)
    );
    let dep_out = String::from_utf8_lossy(&dep.stdout);
    assert!(
        dep_out.contains(&format!("{}\ta@b.com", tokens[0])),
        "{dep_out}"
    );
    assert!(
        dep_out.contains(&format!("{}\tx@y.z", tokens[1])),
        "{dep_out}"
    );

    fs::write(d.join("other-salt.bin"), [9u8; 32]).unwrap();
    let wrong = bin()
        .args([
            "depseudo",
            mapping.to_str().unwrap(),
            "--master-key-file",
            d.join("key.bin").to_str().unwrap(),
            "--salt-file",
            d.join("other-salt.bin").to_str().unwrap(),
            &tokens[0],
        ])
        .output()
        .unwrap();
    assert!(!wrong.status.success(), "wrong salt must abort");

    let tampered = mapping_txt.replace("\"group\":\"email\"", "\"group\":\"phone\"");
    fs::write(&mapping, tampered).unwrap();
    let tam = bin()
        .args([
            "depseudo",
            mapping.to_str().unwrap(),
            "--master-key-file",
            d.join("key.bin").to_str().unwrap(),
            "--salt-file",
            d.join("salt.bin").to_str().unwrap(),
            &tokens[0],
        ])
        .output()
        .unwrap();
    assert!(
        !tam.status.success(),
        "replayed row (group swapped) must fail authentication"
    );

    fs::write(&mapping, mapping_txt).unwrap();
    let miss = bin()
        .args([
            "depseudo",
            mapping.to_str().unwrap(),
            "--master-key-file",
            d.join("key.bin").to_str().unwrap(),
            "--salt-file",
            d.join("salt.bin").to_str().unwrap(),
            "deadbeef",
        ])
        .output()
        .unwrap();
    assert!(!miss.status.success(), "missing token must exit nonzero");
    assert!(String::from_utf8_lossy(&miss.stderr).contains("deadbeef"));
}

#[test]
fn depseudo_short_salt_reports_the_owned_length_rule() {
    let d = tmpdir("depseudo-short-salt");
    fs::write(d.join("in.csv"), "email\nA@B.com\n").unwrap();
    write_key(&d.join("key.bin"), &[5u8; 64]);
    fs::write(d.join("salt.bin"), [2u8; 32]).unwrap();
    let mapping = d.join("customers.mapping");
    let out = run_cli(
        &d,
        "in.csv",
        &[
            fast_key_args(&d),
            vec![
                "--dataset".into(),
                "customers".into(),
                "--reversible".into(),
                "--mapping-file".into(),
                mapping.display().to_string(),
                "--columns".into(),
                "email".into(),
            ],
        ]
        .concat(),
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let written = fs::read_to_string(d.join("out.csv")).unwrap();
    let token = written.lines().nth(1).unwrap().to_string();
    fs::write(d.join("short.salt"), [1u8; 3]).unwrap();

    let dep = bin()
        .args([
            "depseudo",
            mapping.to_str().unwrap(),
            "--master-key-file",
            d.join("key.bin").to_str().unwrap(),
            "--salt-file",
            d.join("short.salt").to_str().unwrap(),
            &token,
        ])
        .output()
        .unwrap();
    assert!(!dep.status.success());
    let err = String::from_utf8_lossy(&dep.stderr);
    assert!(
        err.contains("salt file must be exactly 32 bytes"),
        "session.rs owns the length rule, not the fingerprint wording: {err}"
    );
}

#[test]
fn profile_files_subsume_repeated_flags() {
    let d = tmpdir("profile");
    fs::write(d.join("in.csv"), "email,note\nA@B.com,x\nC@d.eu,y\n").unwrap();
    write_key(&d.join("key.bin"), &[4u8; 64]);
    fs::write(d.join("salt.bin"), [3u8; 32]).unwrap();
    fs::write(
        d.join("customers.toml"),
        "dataset = \"customers-2026\"\ncolumns = \"email:email\"\ntoken-bytes = 8\n",
    )
    .unwrap();

    let mut args = fast_key_args(&d);
    args.push("--profile".into());
    args.push(d.join("customers.toml").display().to_string());
    let out = run_cli(&d, "in.csv", &args);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("0:email=hash:email"),
        "profile columns apply: {stdout}"
    );
    assert!(
        stdout.contains("Dataset namespace: \"customers-2026\""),
        "profile dataset applies: {stdout}"
    );
    let written = fs::read_to_string(d.join("out.csv")).unwrap();
    let token = written.lines().nth(1).unwrap().split(',').next().unwrap();
    assert_eq!(token.len(), 16, "profile token-bytes=8 → 16 hex chars");

    let _ = fs::remove_file(d.join("out.csv"));
    let mut args2 = fast_key_args(&d);
    args2.push("--profile".into());
    args2.push(d.join("customers.toml").display().to_string());
    args2.push("--columns".into());
    args2.push("note".into());
    let out2 = run_cli(&d, "in.csv", &args2);
    assert!(out2.status.success());
    let stdout2 = String::from_utf8_lossy(&out2.stdout);
    assert!(
        stdout2.contains("0:email=keep") && stdout2.contains("1:note=hash"),
        "CLI --columns overrides profile: {stdout2}"
    );

    fs::write(d.join("bad.toml"), "columnz = \"email\"\n").unwrap();
    let mut args3 = fast_key_args(&d);
    args3.push("--profile".into());
    args3.push(d.join("bad.toml").display().to_string());
    let out3 = run_cli(&d, "in.csv", &args3);
    assert!(!out3.status.success(), "unknown profile key must abort");
    assert!(String::from_utf8_lossy(&out3.stderr).contains("columnz"));

    fs::write(d.join("bad2.toml"), "reversible = true\n").unwrap();
    let _ = fs::remove_file(d.join("out.csv"));
    let mut args4 = fast_key_args(&d);
    args4.push("--profile".into());
    args4.push(d.join("bad2.toml").display().to_string());
    let out4 = run_cli(&d, "in.csv", &args4);
    assert!(
        !out4.status.success(),
        "profile reversible without dataset must abort (re-checked post-merge)"
    );
}

#[test]
fn explicit_default_valued_flag_beats_the_profile() {
    let d = tmpdir("profile-explicit-default");
    fs::write(d.join("in.csv"), "email,note\nA@B.com,x\nC@d.eu,y\n").unwrap();
    write_key(&d.join("key.bin"), &[4u8; 64]);
    fs::write(d.join("salt.bin"), [3u8; 32]).unwrap();
    fs::write(
        d.join("p.toml"),
        "columns = \"email:email\"\ntoken-bytes = 8\n",
    )
    .unwrap();

    let mut args = fast_key_args(&d);
    args.push("--profile".into());
    args.push(d.join("p.toml").display().to_string());
    args.push("--token-bytes".into());
    args.push("16".into());
    let out = run_cli(&d, "in.csv", &args);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let written = fs::read_to_string(d.join("out.csv")).unwrap();
    let token = written.lines().nth(1).unwrap().split(',').next().unwrap();
    assert_eq!(token.len(), 32, "explicit --token-bytes 16 → 32 hex chars");
}

#[test]
fn profile_policy_and_policy_file_conflict_fails_closed() {
    let d = tmpdir("profile-pp");
    fs::write(d.join("in.csv"), "email,note\nA@B.com,x\n").unwrap();
    write_key(&d.join("key.bin"), &[4u8; 64]);
    fs::write(d.join("salt.bin"), [3u8; 32]).unwrap();
    fs::write(
        d.join("p.json"),
        r#"{"version":1,"columns":[{"name":"email","action":"hash"}]}"#,
    )
    .unwrap();
    fs::write(
        d.join("both.toml"),
        "policy = \"redact\"\npolicy-file = \"p.json\"\n",
    )
    .unwrap();

    let mut args = fast_key_args(&d);
    args.push("--profile".into());
    args.push(d.join("both.toml").display().to_string());
    let out = run_cli(&d, "in.csv", &args);
    assert!(
        !out.status.success(),
        "a profile cannot smuggle the --policy × --policy-file conflict past the merge"
    );
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(
        err.contains("--policy conflicts with --policy-file"),
        "{err}"
    );
}

#[test]
fn base32_tokens_roundtrip_through_the_whole_toolchain() {
    let d = tmpdir("base32");
    fs::write(d.join("in.csv"), "email,note\nA@B.com,x\nx@Y.z,y\n").unwrap();
    write_key(&d.join("key.bin"), &[6u8; 64]);
    fs::write(d.join("salt.bin"), [7u8; 32]).unwrap();

    let base = [
        fast_key_args(&d),
        svec(["--columns", "email:email", "--token-encoding", "base32"]),
    ]
    .concat();
    let out = run_cli(&d, "in.csv", &base);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let written = fs::read_to_string(d.join("out.csv")).unwrap();
    let token = written.lines().nth(1).unwrap().split(',').next().unwrap();
    assert_eq!(token.len(), 26);
    assert!(
        token.chars().all(|c| matches!(c, 'a'..='z' | '2'..='7')),
        "base32 alphabet: {token}"
    );

    let v = bin()
        .args([
            "verify",
            d.join("out.csv").to_str().unwrap(),
            "--master-key-file",
            d.join("key.bin").to_str().unwrap(),
            "--salt-file",
            d.join("salt.bin").to_str().unwrap(),
            "--token-encoding",
            "base32",
            "--columns",
            "email",
            "--against",
            d.join("in.csv").to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(v.status.success(), "{}", String::from_utf8_lossy(&v.stdout));
    assert!(String::from_utf8_lossy(&v.stdout).contains("26-base32 tokens"));

    let _ = fs::remove_file(d.join("out.csv"));
    let out2 = run_cli(
        &d,
        "in.csv",
        &[fast_key_args(&d), svec(["--columns", "email:email"])].concat(),
    );
    assert!(out2.status.success());
    let hex_written = fs::read_to_string(d.join("out.csv")).unwrap();
    let hex_token = hex_written
        .lines()
        .nth(1)
        .unwrap()
        .split(',')
        .next()
        .unwrap();
    assert_eq!(hex_token.len(), 32, "default hex, 16 bytes → 32 chars");

    let bytes = u128::from_str_radix(hex_token, 16).unwrap().to_be_bytes();
    assert_eq!(
        anonymiser_core::encode_token(&bytes, anonymiser_core::TokenEncoding::Base32),
        token
    );
}
