use crate::common::{bin, tmpdir, TestDir};
use std::fs;

const INPUT: &str = "id,dob,amount\n\
1,1990-01-01,A\n\
2,1990-06-01,A\n\
3,1991-02-02,A\n\
4,1971-03-03,B\n\
5,1972-03-03,B\n\
6,1973-03-03,B\n";

fn setup(name: &str) -> TestDir {
    let d = tmpdir(name);
    fs::write(d.join("in.csv"), INPUT).unwrap();
    d
}

fn inspect(d: &TestDir, extra: &[&str]) -> (bool, String, String) {
    let out = bin()
        .arg("inspect")
        .arg(d.join("in.csv"))
        .args(extra)
        .env("RUST_BACKTRACE", "0")
        .output()
        .unwrap();
    (
        out.status.success(),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn k_line(stdout: &str) -> &str {
    stdout
        .lines()
        .find(|l| l.starts_with("k-anonymity"))
        .unwrap_or_else(|| panic!("no k-anonymity line: {stdout}"))
}

#[test]
fn k_changes_when_a_generalised_column_is_included() {
    let d = setup("inspect-gen-k");

    let (ok, kept, _) = inspect(&d, &["--columns", "id"]);
    assert!(ok);
    assert!(
        k_line(&kept).contains("min k=1, k=1 for 6/6 rows"),
        "{kept}"
    );

    let (ok, year, err) = inspect(&d, &["--columns", "id,dob:year"]);
    assert!(ok, "{err}");
    assert!(k_line(&year).contains("dob [year]"), "{year}");
    assert!(
        k_line(&year).contains("min k=1, k=1 for 4/6 rows"),
        "{year}"
    );

    let (ok, band, err) = inspect(
        &d,
        &[
            "--columns",
            "id,dob:age-band",
            "--reference-date",
            "2026-01-01",
        ],
    );
    assert!(ok, "{err}");
    let line = k_line(&band);
    assert!(
        line.contains("amount") && line.contains("dob [age-band]"),
        "{band}"
    );
    assert!(line.contains("min k=3, k=1 for 0/6 rows"), "{band}");
    assert!(!band.contains("uniquely identifiable"), "{band}");
    assert!(
        band.contains("age-band"),
        "plan row names the policy: {band}"
    );

    let (_, hashed, _) = inspect(&d, &["--columns", "id,dob"]);
    assert!(!k_line(&hashed).contains("dob"), "{hashed}");
}

#[test]
fn generalised_values_group_unparseable_cells_as_redacted_and_width_applies() {
    let d = tmpdir("inspect-gen-width");
    fs::write(
        d.join("in.csv"),
        "id,score\n1,21\n2,24\n3,29\n4,31\n5,not-a-number\n6,also-bad\n",
    )
    .unwrap();
    let (ok, out, err) = inspect(&d, &["--columns", "id,score:bucket=10"]);
    assert!(ok, "{err}");
    assert!(k_line(&out).contains("score [bucket]"), "{out}");
    assert!(k_line(&out).contains("min k=1, k=1 for 1/6 rows"), "{out}");
}

#[test]
fn age_band_without_reference_date_is_refused_by_inspect_too() {
    let d = setup("inspect-gen-noref");
    let (ok, _, err) = inspect(&d, &["--columns", "id,dob:age-band"]);
    assert!(!ok);
    assert!(err.contains("--reference-date"), "{err}");
}
