use crate::common::{fast_key_args, run_cli, svec, tmpdir, write_key, TestDir};
use std::fs;
use std::path::Path;

const INPUT: &str = "id,dob,score,joined,note\n\
1,1996-01-01,27,2021/06/30,keep\n\
2,1996-01-02,9.8,2021-06-30T10:20:30Z,keep\n\
3,07/03/1985,twelve,30/06/2021,keep\n\
4, ,,  ,keep\n\
5,1930-05-05,-3,2021.06.30,keep\n";

fn setup(name: &str) -> TestDir {
    let d = tmpdir(name);
    write_key(&d.join("key.bin"), &[5u8; 64]);
    fs::write(d.join("salt.bin"), [2u8; 32]).unwrap();
    fs::write(d.join("in.csv"), INPUT).unwrap();
    d
}

fn run(d: &Path, extra: &[String]) -> std::process::Output {
    run_cli(d, "in.csv", &[fast_key_args(d), extra.to_vec()].concat())
}

fn rows(d: &Path) -> Vec<Vec<String>> {
    fs::read_to_string(d.join("out.csv"))
        .unwrap()
        .lines()
        .skip(1)
        .map(|l| l.split(',').map(str::to_string).collect())
        .collect()
}

fn stdout(o: &std::process::Output) -> String {
    String::from_utf8_lossy(&o.stdout).into_owned()
}

fn stderr(o: &std::process::Output) -> String {
    String::from_utf8_lossy(&o.stderr).into_owned()
}

#[test]
fn per_column_suffixes_generalise_and_pin_the_output() {
    let d = setup("gen-suffix");
    let out = run(
        &d,
        &svec([
            "--columns",
            "dob:age-band,score:bucket=5,joined:year",
            "--reference-date",
            "2026-01-01",
        ]),
    );
    assert!(out.status.success(), "{}", stderr(&out));
    let r = rows(&d);
    assert_eq!(r[0], ["1", "30-39", "25-29", "2021", "keep"]);
    assert_eq!(r[1], ["2", "20-29", "5-9", "2021", "keep"]);
    assert_eq!(
        r[2],
        ["3", "[REDACTED]", "[REDACTED]", "[REDACTED]", "keep"]
    );
    assert_eq!(r[3], ["4", " ", "", "  ", "keep"]);
    assert_eq!(r[4], ["5", "90+", "-5--1", "2021", "keep"]);

    let summary = stdout(&out);
    assert!(
        summary.contains("age-band[width=10,ref=2026-01-01]")
            && summary.contains("bucket[width=5]"),
        "run summary records the parameters in force: {summary}"
    );
}

#[test]
fn global_policy_with_width_and_reference_date() {
    let d = setup("gen-global");
    let out = run(
        &d,
        &svec(["--columns", "score", "--policy", "bucket", "--width", "20"]),
    );
    assert!(out.status.success(), "{}", stderr(&out));
    assert_eq!(rows(&d)[0][2], "20-39");

    let out = run(
        &d,
        &svec([
            "--force",
            "--columns",
            "dob",
            "--policy",
            "age-band",
            "--reference-date",
            "2026-01-01",
            "--width",
            "5",
        ]),
    );
    assert!(out.status.success(), "{}", stderr(&out));
    assert_eq!(rows(&d)[0][1], "30-34");
}

#[test]
fn age_band_without_a_reference_date_fails_closed_before_any_output() {
    let d = setup("gen-noref");
    let out = run(&d, &svec(["--columns", "dob:age-band"]));
    assert!(!out.status.success());
    let err = stderr(&out);
    assert!(
        err.contains("reference date") && err.contains("--reference-date"),
        "{err}"
    );
    assert!(!d.join("out.csv").exists(), "no output on a refused plan");

    let bad = run(
        &d,
        &svec([
            "--columns",
            "dob:age-band",
            "--reference-date",
            "01/01/2026",
        ]),
    );
    assert!(!bad.status.success());
    assert!(stderr(&bad).contains("yyyy-mm-dd"), "{}", stderr(&bad));
}

#[test]
fn bad_suffixes_and_widths_are_errors() {
    let d = setup("gen-badsuffix");
    for cols in [
        "score:bucket=0",
        "score:bucket=x",
        "score:bucket=-5",
        "joined:year=5",
        "score:email=5",
        "score:decade",
    ] {
        let out = run(&d, &svec(["--columns", cols]));
        assert!(!out.status.success(), "{cols} should fail");
        assert!(!d.join("out.csv").exists(), "{cols}");
    }
}

#[test]
fn policy_file_carries_per_column_parameters() {
    let d = setup("gen-policyfile");
    fs::write(
        d.join("policy.json"),
        r#"{"version":1,"columns":[
            {"name":"dob","action":"age-band","width":20,"reference_date":"2030-01-01"},
            {"name":"score","action":"bucket","width":5},
            {"name":"joined","action":"year"}
        ]}"#,
    )
    .unwrap();
    let pf = d.join("policy.json").display().to_string();
    let out = run(&d, &["--policy-file".to_string(), pf]);
    assert!(out.status.success(), "{}", stderr(&out));
    let r = rows(&d);
    assert_eq!(r[0], ["1", "20-39", "25-29", "2021", "keep"]);
}

#[test]
fn policy_file_defaults_come_from_the_flags_and_misplaced_params_fail() {
    let d = setup("gen-policyfile-defaults");
    fs::write(
        d.join("policy.json"),
        r#"{"version":1,"columns":[{"name":"dob","action":"age-band"}]}"#,
    )
    .unwrap();
    let pf = d.join("policy.json").display().to_string();
    let args = |extra: &[&str]| {
        [
            vec!["--policy-file".to_string(), pf.clone()],
            extra.iter().map(|s| s.to_string()).collect(),
        ]
        .concat()
    };
    let missing = run(&d, &args(&[]));
    assert!(!missing.status.success(), "age-band needs a reference date");

    let ok = run(&d, &args(&["--reference-date", "2026-01-01"]));
    assert!(ok.status.success(), "{}", stderr(&ok));
    assert_eq!(rows(&d)[0][1], "30-39");

    for (action, extra) in [
        ("year", r#","width":5"#),
        ("bucket", r#","reference_date":"2026-01-01""#),
        ("redact", r#","width":5"#),
        ("bucket", r#","width":0"#),
    ] {
        fs::write(
            d.join("bad.json"),
            format!(r#"{{"version":1,"columns":[{{"name":"score","action":"{action}"{extra}}}]}}"#),
        )
        .unwrap();
        let bad = d.join("bad.json").display().to_string();
        let out = run(
            &d,
            &svec(["--force"])
                .into_iter()
                .chain(["--policy-file".into(), bad])
                .collect::<Vec<_>>(),
        );
        assert!(!out.status.success(), "{action}{extra} must be rejected");
    }
}

#[test]
fn profile_supplies_the_reference_date() {
    let d = setup("gen-profile");
    fs::write(
        d.join("p.toml"),
        "columns = \"dob:age-band\"\nreference-date = \"2026-01-01\"\nwidth = 5\n",
    )
    .unwrap();
    let out = run(
        &d,
        &[
            "--profile".to_string(),
            d.join("p.toml").display().to_string(),
        ],
    );
    assert!(out.status.success(), "{}", stderr(&out));
    assert_eq!(rows(&d)[0][1], "30-34");
}

#[test]
fn generalisation_is_deterministic_and_keyless() {
    let d = setup("gen-determinism");
    let args = svec([
        "--columns",
        "dob:age-band,score:bucket,joined:year",
        "--reference-date",
        "2026-01-01",
    ]);
    assert!(run(&d, &args).status.success());
    let first = fs::read(d.join("out.csv")).unwrap();
    write_key(&d.join("key.bin"), &[9u8; 64]);
    fs::write(d.join("salt.bin"), [8u8; 32]).unwrap();
    let again = [svec(["--force"]), args].concat();
    assert!(run(&d, &again).status.success());
    assert_eq!(first, fs::read(d.join("out.csv")).unwrap());
}
