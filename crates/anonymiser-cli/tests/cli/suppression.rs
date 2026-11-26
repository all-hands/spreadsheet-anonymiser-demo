use crate::common::{bin, fast_key_args, run_cli, svec, tmpdir, write_key, TestDir};
use std::fs;

const INPUT: &str = "id,name,dob,city\n\
1,Ann,1990-01-01,Athens\n\
2,Bob,1991-02-02,Athens\n\
3,Cy,1992-03-03,Athens\n\
4,Di,1980-04-04,Athens\n\
5,Ed,1981-05-05,Patras\n\
6,Flo,1970-06-06,Patras\n";

fn setup(name: &str) -> TestDir {
    let d = tmpdir(name);
    fs::write(d.join("in.csv"), INPUT).unwrap();
    write_key(&d.join("key.bin"), &[5u8; 64]);
    fs::write(d.join("salt.bin"), [2u8; 32]).unwrap();
    d
}

fn run(d: &TestDir, extra: &[&str]) -> std::process::Output {
    let mut args = fast_key_args(d);
    args.extend(svec([
        "--columns",
        "name,dob:age-band=10",
        "--policy",
        "redact",
        "--reference-date",
        "2026-01-01",
    ]));
    args.extend(extra.iter().map(|s| s.to_string()));
    run_cli(d, "in.csv", &args)
}

fn text(o: &[u8]) -> String {
    String::from_utf8_lossy(o).into_owned()
}

#[test]
fn cells_mode_blanks_small_groups_and_records_it() {
    let d = setup("supp-cells");
    let o = run(&d, &["--quasi-identifiers", "dob,city", "--min-group", "2"]);
    assert!(o.status.success(), "{}", text(&o.stderr));
    let out = fs::read_to_string(d.join("out.csv")).unwrap();
    assert_eq!(
        out,
        "id,name,dob,city\n\
1,[REDACTED],30-39,Athens\n\
2,[REDACTED],30-39,Athens\n\
3,[REDACTED],30-39,Athens\n\
4,[REDACTED],*,*\n\
5,[REDACTED],*,*\n\
6,[REDACTED],*,*\n"
    );
    let so = text(&o.stdout);
    assert!(so.contains("Suppression: cells on quasi-identifiers [dob, city], min group 2: 3 of 6"));
    assert!(so.contains(
        "Measured: every combination of dob, city in this output is shared by at least 3 rows \
         (target k=2). This holds for this file only; it says nothing about linkage with other \
         data."
    ));
    assert!(so.contains("Smallest remaining group 3 (was 1)."));
    let m = fs::read_to_string(d.join("out.csv.manifest.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&m).unwrap();
    assert_eq!(v["schema_version"], 1);
    assert_eq!(v["suppression"]["mode"], "cells");
    assert_eq!(v["suppression"]["min_group"], 2);
    assert_eq!(
        v["suppression"]["quasi_identifiers"],
        serde_json::json!([2, 3])
    );
    assert_eq!(v["suppression"]["cells_suppressed"], 6);
    assert_eq!(v["output"]["rows"], 6);
}

#[test]
fn rows_mode_drops_rows_and_manifest_counts_differ() {
    let d = setup("supp-rows");
    let o = run(
        &d,
        &[
            "--quasi-identifiers",
            "dob,city",
            "--min-group",
            "3",
            "--suppress",
            "rows",
        ],
    );
    assert!(o.status.success(), "{}", text(&o.stderr));
    let out = fs::read_to_string(d.join("out.csv")).unwrap();
    assert_eq!(out.lines().count(), 4);
    assert!(text(&o.stdout).contains("(3 rows)"));
    let v: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(d.join("out.csv.manifest.json")).unwrap())
            .unwrap();
    assert_eq!(v["input"]["rows"], 6);
    assert_eq!(v["output"]["rows"], 3);
    assert_eq!(v["suppression"]["rows_dropped"], 3);
    let ver = bin()
        .arg("verify")
        .arg(d.join("out.csv"))
        .arg("--manifest")
        .arg(d.join("out.csv.manifest.json"))
        .output()
        .unwrap();
    assert!(ver.status.success(), "{}", text(&ver.stdout));
}

#[test]
fn run_without_suppression_has_no_manifest_field() {
    let d = setup("supp-none");
    let o = run(&d, &[]);
    assert!(o.status.success(), "{}", text(&o.stderr));
    let m = fs::read_to_string(d.join("out.csv.manifest.json")).unwrap();
    assert!(!m.contains("suppression"), "{m}");
}

#[test]
fn inconsistent_options_are_refused_before_output() {
    let d = setup("supp-refuse");
    let cases: &[(&[&str], &str)] = &[
        (&["--quasi-identifiers", "dob"], "--min-group"),
        (&["--min-group", "3"], "--quasi-identifiers"),
        (&["--suppress", "rows"], "--quasi-identifiers"),
        (
            &["--quasi-identifiers", "dob", "--min-group", "1"],
            "minimum group size must be at least 2",
        ),
        (
            &["--quasi-identifiers", "nope", "--min-group", "2"],
            "column \"nope\" not found",
        ),
        (
            &["--quasi-identifiers", "dob,2", "--min-group", "2"],
            "listed more than once",
        ),
        (
            &["--quasi-identifiers", "9", "--min-group", "2"],
            "out of range",
        ),
        (
            &[
                "--quasi-identifiers",
                "dob",
                "--min-group",
                "2",
                "--suppress",
                "blur",
            ],
            "invalid value",
        ),
        (
            &[
                "--quasi-identifiers",
                "dob",
                "--min-group",
                "2",
                "--reversible",
                "--dataset",
                "d",
            ],
            "cannot be used with",
        ),
    ];
    for (extra, want) in cases {
        let o = run(&d, extra);
        assert!(!o.status.success(), "{extra:?} should fail");
        assert!(
            text(&o.stderr).contains(want),
            "{extra:?}: {}",
            text(&o.stderr)
        );
        assert!(!d.join("out.csv").exists(), "{extra:?} left an output");
    }
}

#[test]
fn verify_against_refuses_a_suppressed_manifest() {
    let d = setup("supp-verify");
    let o = run(&d, &["--quasi-identifiers", "city", "--min-group", "2"]);
    assert!(o.status.success(), "{}", text(&o.stderr));
    let ver = bin()
        .arg("verify")
        .arg(d.join("out.csv"))
        .arg("--manifest")
        .arg(d.join("out.csv.manifest.json"))
        .arg("--against")
        .arg(d.join("in.csv"))
        .arg("--master-key-file")
        .arg(d.join("key.bin"))
        .arg("--salt-file")
        .arg(d.join("salt.bin"))
        .output()
        .unwrap();
    assert!(!ver.status.success());
    assert!(
        text(&ver.stdout).contains("k-anonymity suppression"),
        "{}",
        text(&ver.stdout)
    );
}

#[test]
fn inspect_k_line_is_unchanged_by_the_core_measurer() {
    let d = setup("supp-inspect");
    let o = bin()
        .arg("inspect")
        .arg(d.join("in.csv"))
        .args(["--columns", "id,name"])
        .output()
        .unwrap();
    let so = text(&o.stdout);
    assert!(so.contains("min k=1, k=1 for 6/6 rows (100%)"), "{so}");
}

#[test]
fn parity_fixtures_pin_both_modes_byte_for_byte() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/parity");
    let d = tmpdir("supp-parity");
    let salt: Vec<u8> = (0u8..32).collect();
    fs::write(d.join("salt.bin"), salt).unwrap();
    for (input, mode, expected) in [
        ("anonymity.csv", "cells", "anonymity.expected.cells.csv"),
        ("anonymity.csv", "rows", "anonymity.expected.rows.csv"),
        (
            "anonymity.excluded-input.csv",
            "cells",
            "anonymity.expected.excluded-cells.csv",
        ),
        (
            "anonymity.excluded-input.csv",
            "rows",
            "anonymity.expected.excluded-rows.csv",
        ),
    ] {
        let o = bin()
            .arg("anonymise")
            .arg(root.join(input))
            .arg(d.join("out.csv"))
            .args(["--passphrase", "parity-passphrase", "--salt-file"])
            .arg(d.join("salt.bin"))
            .args(["--dataset", "parity", "--policy-file"])
            .arg(root.join("anonymity-policy.json"))
            .args([
                "--reference-date",
                "2026-01-01",
                "--quasi-identifiers",
                "dob,city",
                "--min-group",
                "2",
                "--suppress",
                mode,
                "--force",
                "--no-manifest",
            ])
            .output()
            .unwrap();
        assert!(o.status.success(), "{}", text(&o.stderr));
        assert_eq!(
            fs::read(d.join("out.csv")).unwrap(),
            fs::read(root.join(expected)).unwrap(),
            "{input} --suppress {mode} drifted from {expected}"
        );
    }
}

#[test]
fn small_table_fully_suppressed_does_not_claim_the_target_is_met() {
    let d = tmpdir("supp-small");
    fs::write(
        d.join("in.csv"),
        "id,dob,city\n1,1990-01-01,Athens\n2,1991-02-02,Athens\n3,1992-03-03,Athens\n",
    )
    .unwrap();
    write_key(&d.join("key.bin"), &[5u8; 64]);
    fs::write(d.join("salt.bin"), [2u8; 32]).unwrap();
    let mut args = fast_key_args(&d);
    args.extend(svec([
        "--columns",
        "dob:age-band=10",
        "--reference-date",
        "2026-01-01",
        "--quasi-identifiers",
        "dob,city",
        "--min-group",
        "5",
        "--suppress",
        "cells",
    ]));
    let o = run_cli(&d, "in.csv", &args);
    assert!(o.status.success(), "{}", text(&o.stderr));
    let so = text(&o.stdout);
    assert!(so.contains("No rows to measure on dob, city."), "{so}");
    assert!(!so.contains("Measured: every combination"), "{so}");
    assert!(!so.contains("meets the target"), "{so}");
}
