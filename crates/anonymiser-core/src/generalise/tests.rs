use super::*;

fn d(y: u16, m: u8, day: u8) -> Date {
    Date::new(y, m, day).unwrap()
}

#[test]
fn date_validity_and_leap_years() {
    assert!(Date::new(2024, 2, 29).is_some());
    assert!(Date::new(2023, 2, 29).is_none());
    assert!(Date::new(1900, 2, 29).is_none(), "century, not leap");
    assert!(Date::new(2000, 2, 29).is_some(), "400-year, leap");
    assert!(Date::new(2024, 4, 31).is_none());
    assert!(Date::new(2024, 13, 1).is_none());
    assert!(Date::new(2024, 0, 1).is_none());
    assert!(Date::new(0, 1, 1).is_none());
    assert!(Date::new(10_000, 1, 1).is_none());
}

#[test]
fn reference_date_is_strict_iso() {
    assert_eq!("2026-01-01".parse::<Date>().unwrap(), d(2026, 1, 1));
    assert_eq!(d(2026, 1, 1).to_string(), "2026-01-01");
    for bad in [
        "",
        "2026/01/01",
        "2026-1-1",
        "26-01-01",
        "2026-02-30",
        "2026-01-01T00:00",
        " 2026-01-01",
        "2026-01-0１",
    ] {
        assert!(bad.parse::<Date>().is_err(), "{bad:?}");
    }
}

#[test]
fn cell_dates_accept_the_documented_shapes() {
    let want = Some(d(1985, 3, 7));
    for ok in [
        "1985-03-07",
        "1985/03/07",
        "1985.03.07",
        "  1985-03-07  ",
        "1985-03-07T10:20:30Z",
        "1985-03-07 10:20",
    ] {
        assert_eq!(parse_cell_date(ok), want, "{ok:?}");
    }
}

#[test]
fn cell_dates_reject_ambiguous_and_malformed() {
    for bad in [
        "07/03/1985",
        "03/07/1985",
        "1985-3-7",
        "85-03-07",
        "1985-02-30",
        "1985-03-07x",
        "1985-03-07 x",
        "1985-03-07Tx",
        "1985_03_07",
        "1985-03/07",
        "yesterday",
        "",
        "19850307",
        "1985-03-0é",
        "ééééé",
    ] {
        assert_eq!(parse_cell_date(bad), None, "{bad:?}");
    }
}

#[test]
fn year_of_formats_four_digits() {
    assert_eq!(year_of("1985-03-07").as_deref(), Some("1985"));
    assert_eq!(year_of("0999-12-31").as_deref(), Some("0999"));
    assert_eq!(year_of("not a date"), None);
}

#[test]
fn age_counts_completed_years_and_birthday_on_reference_date() {
    let r = d(2026, 6, 15);
    assert_eq!(
        d(1996, 6, 15).age_on(r),
        Some(30),
        "birthday today: happened"
    );
    assert_eq!(d(1996, 6, 16).age_on(r), Some(29), "birthday tomorrow");
    assert_eq!(d(1996, 6, 14).age_on(r), Some(30));
    assert_eq!(
        d(2026, 6, 15).age_on(r),
        Some(0),
        "born on the reference date"
    );
    assert_eq!(
        d(2026, 6, 16).age_on(r),
        None,
        "born after the reference date"
    );
}

#[test]
fn leap_day_birthday_arrives_on_march_first_in_common_years() {
    let dob = d(2000, 2, 29);
    assert_eq!(dob.age_on(d(2023, 2, 28)), Some(22));
    assert_eq!(dob.age_on(d(2023, 3, 1)), Some(23));
    assert_eq!(dob.age_on(d(2024, 2, 28)), Some(23));
    assert_eq!(dob.age_on(d(2024, 2, 29)), Some(24));
}

#[test]
fn age_band_default_width() {
    let r = d(2026, 1, 1);
    assert_eq!(age_band("1996-01-01", 10, r).as_deref(), Some("30-39"));
    assert_eq!(age_band("1996-01-02", 10, r).as_deref(), Some("20-29"));
    assert_eq!(age_band("2026-01-01", 10, r).as_deref(), Some("0-9"));
    assert_eq!(age_band("1937-01-01", 10, r).as_deref(), Some("80-89"));
    assert_eq!(age_band("1936-01-01", 10, r).as_deref(), Some("90+"));
    assert_eq!(age_band("1800-01-01", 10, r).as_deref(), Some("90+"));
}

#[test]
fn age_band_other_widths_and_open_top() {
    let r = d(2026, 1, 1);
    assert_eq!(age_band("1990-01-01", 5, r).as_deref(), Some("35-39"));
    assert_eq!(age_band("1990-01-01", 1, r).as_deref(), Some("36"));
    assert_eq!(age_band("1930-01-01", 20, r).as_deref(), Some("80+"));
    assert_eq!(age_band("1940-01-01", 20, r).as_deref(), Some("80+"));
    assert_eq!(age_band("1950-01-01", 20, r).as_deref(), Some("60-79"));
    assert_eq!(age_band("1920-01-01", 7, r).as_deref(), Some("84+"));
    assert_eq!(age_band("1990-01-01", 100, r).as_deref(), Some("0+"));
}

#[test]
fn age_band_rejects_bad_and_future_dates() {
    let r = d(2026, 1, 1);
    assert_eq!(age_band("2027-01-01", 10, r), None);
    assert_eq!(age_band("07/03/1985", 10, r), None);
    assert_eq!(age_band("", 10, r), None);
}

#[test]
fn bucket_integers() {
    assert_eq!(bucket("0", 10).as_deref(), Some("0-9"));
    assert_eq!(bucket("9", 10).as_deref(), Some("0-9"));
    assert_eq!(bucket("10", 10).as_deref(), Some("10-19"));
    assert_eq!(bucket("27", 10).as_deref(), Some("20-29"));
    assert_eq!(bucket("27", 5).as_deref(), Some("25-29"));
    assert_eq!(bucket("27", 1).as_deref(), Some("27"));
    assert_eq!(bucket(" +27 ", 10).as_deref(), Some("20-29"));
    assert_eq!(bucket("007", 10).as_deref(), Some("0-9"));
}

#[test]
fn bucket_negative_numbers_floor_toward_minus_infinity() {
    assert_eq!(bucket("-1", 10).as_deref(), Some("-10--1"));
    assert_eq!(bucket("-10", 10).as_deref(), Some("-10--1"));
    assert_eq!(bucket("-11", 10).as_deref(), Some("-20--11"));
    assert_eq!(bucket("-0", 10).as_deref(), Some("0-9"));
    assert_eq!(bucket("-0.0", 10).as_deref(), Some("0-9"));
    assert_eq!(bucket("-0.5", 10).as_deref(), Some("-10--1"));
    assert_eq!(bucket("-10.5", 10).as_deref(), Some("-20--11"));
}

#[test]
fn bucket_decimals_use_the_floor() {
    assert_eq!(bucket("29.99", 10).as_deref(), Some("20-29"));
    assert_eq!(bucket("30.0", 10).as_deref(), Some("30-39"));
    assert_eq!(bucket("0.5", 10).as_deref(), Some("0-9"));
    assert_eq!(bucket("9.8", 5).as_deref(), Some("5-9"));
}

#[test]
fn bucket_huge_numbers() {
    let big = "170141183460469231731687303715884105727";
    assert_eq!(bucket(big, 1).as_deref(), Some(big));
    assert_eq!(bucket(big, 10), None);
    assert_eq!(
        bucket("170141183460469231731687303715884105700", 10).as_deref(),
        Some("170141183460469231731687303715884105700-170141183460469231731687303715884105709")
    );
    assert_eq!(
        bucket("1000000000000000000000", 10)
            .as_deref()
            .map(str::len),
        Some(45)
    );
    assert_eq!(bucket("170141183460469231731687303715884105728", 10), None);
    assert_eq!(
        bucket("-170141183460469231731687303715884105727", 1_000),
        None
    );
    assert_eq!(
        bucket("-170141183460469231731687303715884105728", 1_000),
        None
    );
    assert_eq!(bucket(&"9".repeat(400), 10), None);
}

#[test]
fn zero_width_never_panics() {
    assert_eq!(bucket("5", 0), None);
    assert_eq!(age_band("1990-01-01", 0, d(2026, 1, 1)), None);
}

#[test]
fn bucket_rejects_non_numbers() {
    for bad in [
        "", "abc", "1e5", "1,5", "1 000", "0x10", "NaN", "inf", ".5", "5.", "--5", "+-5", "1.2.3",
        "12abc", "٣", "-", "+", "1_000",
    ] {
        assert_eq!(bucket(bad, 10), None, "{bad:?}");
    }
}

#[test]
fn date_validity_matches_an_independent_calendar_oracle() {
    fn leap(y: u32) -> bool {
        (y.is_multiple_of(4) && !y.is_multiple_of(100)) || y.is_multiple_of(400)
    }
    fn oracle(y: u32, m: u32, d: u32) -> bool {
        let len = match m {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 if leap(y) => 29,
            2 => 28,
            _ => return false,
        };
        (1..=9999).contains(&y) && (1..=len).contains(&d)
    }
    for y in [
        0u32, 1, 2, 3, 4, 100, 400, 1582, 1900, 2000, 2023, 2024, 9999,
    ] {
        for m in 0..=13u32 {
            for day in 0..=32u32 {
                let got = Date::new(y as u16, m as u8, day as u8).is_some();
                assert_eq!(got, oracle(y, m, day), "{y}-{m}-{day}");
            }
        }
    }
    for y in 0..=10_001u32 {
        let got = Date::new(y as u16, 2, 29).is_some();
        assert_eq!(got, oracle(y, 2, 29), "{y}-02-29");
    }
    assert!(Date::new(2024, 200, 1).is_none());
    assert!(Date::new(2024, 1, 129).is_none());
    assert!(Date::new(2024, 1, 255).is_none());
    for s in ["0001-01-01", "9999-12-31", "2024-02-29"] {
        assert_eq!(s.parse::<Date>().unwrap().to_string(), s);
    }
    assert_eq!(d(1, 1, 1).year(), 1);
    assert_eq!(d(9999, 12, 31).year(), 9999);
    assert!(d(2024, 2, 28) < d(2024, 2, 29));
    assert!(d(2023, 12, 31) < d(2024, 1, 1));
}
