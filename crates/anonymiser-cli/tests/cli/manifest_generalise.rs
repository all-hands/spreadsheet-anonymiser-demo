use crate::common::{bin, fast_key_args, run_cli, svec, tmpdir, write_key, TestDir};
use std::fs;

const INPUT: &str = "id,email,dob,score\n\
1,alice@example.org,1990-05-01,27\n\
2,bob@example.org,1971-03-03,81\n";

fn run_generalised() -> TestDir {
    let d = tmpdir("manifest-gen");
    fs::write(d.join("in.csv"), INPUT).unwrap();
    write_key(&d.join("key.bin"), &[5u8; 64]);
    fs::write(d.join("salt.bin"), [2u8; 32]).unwrap();
    let mut args = fast_key_args(&d);
    args.extend(svec([
        "--columns",
        "email,dob:age-band=5,score:bucket=20",
        "--reference-date",
        "2026-01-01",
    ]));
    let out = run_cli(&d, "in.csv", &args);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    d
}

fn verify(d: &TestDir, extra: &[&str]) -> (bool, String, String) {
    let o = bin()
        .arg("verify")
        .arg(d.join("out.csv"))
        .arg("--manifest")
        .arg(d.join("out.csv.manifest.json"))
        .args(extra)
        .env("RUST_BACKTRACE", "0")
        .output()
        .unwrap();
    (
        o.status.success(),
        String::from_utf8_lossy(&o.stdout).into_owned(),
        String::from_utf8_lossy(&o.stderr).into_owned(),
    )
}

#[test]
fn manifest_records_width_and_reference_date_but_no_keying_for_generalised_columns() {
    let d = run_generalised();
    let m: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(d.join("out.csv.manifest.json")).unwrap())
            .unwrap();
    let cols = m["columns"].as_array().unwrap();
    assert_eq!(cols[2]["policy"], "age-band");
    assert_eq!(cols[2]["width"], 5);
    assert_eq!(cols[2]["reference_date"], "2026-01-01");
    assert_eq!(cols[3]["policy"], "bucket");
    assert_eq!(cols[3]["width"], 20);
    assert!(cols[3].get("reference_date").is_none());
    assert!(cols[2]["group"].is_null() && cols[3]["group"].is_null());
    assert!(cols[1].get("width").is_none() && cols[0].get("reference_date").is_none());
}

#[test]
fn verify_manifest_names_generalised_columns_and_scopes_the_pii_scan() {
    let d = run_generalised();
    let (ok, out, err) = verify(&d, &[]);
    assert!(ok, "{out}{err}");
    assert!(
        out.contains(
            "column dob — age-band[width=5,ref=2026-01-01]: generalised values, not tokens"
        ),
        "{out}"
    );
    assert!(
        out.contains("column score — bucket[width=20]: generalised"),
        "{out}"
    );
    assert!(
        out.contains("column email — 2 cells are 32-hex tokens"),
        "{out}"
    );
    assert!(out.contains("1 kept column(s)"), "{out}");
}

#[test]
fn verify_against_recomputes_generalised_columns_and_catches_tampering() {
    let d = run_generalised();
    let key = d.join("key.bin").display().to_string();
    let salt = d.join("salt.bin").display().to_string();
    let orig = d.join("in.csv").display().to_string();
    let extra = [
        "--master-key-file",
        key.as_str(),
        "--salt-file",
        salt.as_str(),
        "--against",
        orig.as_str(),
    ];
    let (ok, out, err) = verify(&d, &extra);
    assert!(ok, "{out}{err}");
    assert!(
        out.contains("column dob — 2 age-band cells match the original"),
        "{out}"
    );
    assert!(
        out.contains("column score — 2 bucket cells match the original"),
        "{out}"
    );

    let tampered = fs::read_to_string(d.join("out.csv"))
        .unwrap()
        .replace("35-39", "30-34");
    fs::write(d.join("out.csv"), tampered).unwrap();
    let (ok, out, _) = verify(&d, &extra);
    assert!(!ok, "{out}");
    assert!(
        out.contains("SHA-256") && out.contains("changed since the run"),
        "{out}"
    );
    assert!(
        out.contains("re-computation failed for column dob"),
        "{out}"
    );
}

#[test]
fn verify_columns_suffix_points_at_manifest_or_policy_file() {
    let d = run_generalised();
    let o = bin()
        .arg("verify")
        .arg(d.join("out.csv"))
        .args(["--columns", "dob:age-band"])
        .env("RUST_BACKTRACE", "0")
        .output()
        .unwrap();
    assert!(!o.status.success());
    let err = String::from_utf8_lossy(&o.stderr);
    assert!(
        err.contains("generalisation policy") && err.contains("--manifest"),
        "{err}"
    );
}
