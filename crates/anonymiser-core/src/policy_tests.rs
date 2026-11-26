use super::*;

#[test]
fn vocabulary_round_trips() {
    for s in POLICY_VOCABULARY {
        let p = Policy::from_str(s).unwrap_or_else(|e| panic!("vocabulary {s:?}: {e}"));
        assert_eq!(p.as_str(), *s, "spelling drift for {s:?}");
        assert_eq!(p.to_string(), *s);
        assert_eq!(Policy::from_str(&p.to_string()).unwrap(), p);
    }
    assert!(Policy::from_str("nope").is_err());
    assert!(Policy::from_str("Hash").is_err());
}

#[test]
fn vocabulary_covers_every_variant_exactly_once() {
    let all = [
        Policy::Keep,
        Policy::Redact,
        Policy::Mask(MaskKind::Auto),
        Policy::Mask(MaskKind::Email),
        Policy::Mask(MaskKind::Last4),
        Policy::Hash,
        Policy::Faux,
        Policy::Year,
        Policy::AgeBand {
            width: DEFAULT_WIDTH,
            reference: None,
        },
        Policy::Bucket {
            width: DEFAULT_WIDTH,
        },
        Policy::Encrypt,
        Policy::KyberAes,
        Policy::LegacyHmacSha256,
        Policy::LegacySha256,
        Policy::LegacyMask,
        Policy::LegacyAes,
        Policy::LegacyKyberAes,
    ];
    for p in all {
        assert!(
            POLICY_VOCABULARY.contains(&p.as_str()),
            "{p} missing from the vocabulary"
        );
    }
    assert_eq!(
        POLICY_VOCABULARY.len(),
        all.len(),
        "vocabulary has extra or duplicate entries"
    );
}

#[test]
fn deprecated_vocabulary_is_exactly_the_refused_subset() {
    for s in DEPRECATED_POLICY_VOCABULARY {
        assert!(POLICY_VOCABULARY.contains(s), "{s:?} not in the vocabulary");
    }
    for s in POLICY_VOCABULARY {
        let p = Policy::from_str(s).unwrap();
        let listed = DEPRECATED_POLICY_VOCABULARY.contains(s);
        assert_eq!(p.is_deprecated(), listed, "{s:?}");
        assert_eq!(p.for_new_run().is_err(), listed, "{s:?}");
        assert_eq!(p.deprecation_notice().is_some(), listed, "{s:?}");
    }
    assert_eq!(DEPRECATED_POLICY_VOCABULARY, ["kyber-aes"]);
    assert!(Policy::LegacyKyberAes.for_new_run().is_ok());
}

#[test]
fn kyber_aes_notice_names_the_replacement() {
    let err = Policy::KyberAes.for_new_run().unwrap_err();
    assert_eq!(
        err.to_string(),
        "policy \"kyber-aes\" is deprecated and refused for new runs: its ML-KEM layer is \
         keyed from the column key, so it adds no protection over AES-256-GCM; use \
         \"encrypt\" instead (existing kyber:v1: cells still decrypt)"
    );
}

fn age_band(width: u32, reference: &str) -> Policy {
    Policy::from_str("age-band")
        .unwrap()
        .with_params(Some(width), Some(reference.parse().unwrap()))
        .unwrap()
}

fn run(value: &str, p: Policy) -> String {
    apply(value, p, None, 16).unwrap()
}

#[test]
fn generalisation_policies_apply() {
    assert_eq!(run("1985-03-07", Policy::Year), "1985");
    assert_eq!(run("1985/03/07", Policy::Year), "1985");
    assert_eq!(run("1996-01-01", age_band(10, "2026-01-01")), "30-39");
    assert_eq!(run("1996-01-02", age_band(10, "2026-01-01")), "20-29");
    assert_eq!(
        run("27", Policy::from_str("bucket").unwrap()),
        "20-29",
        "defaults from the bare wire string"
    );
    assert_eq!(run("27", Policy::Bucket { width: 5 }), "25-29");
}

#[test]
fn generalisation_is_fail_safe_on_bad_input() {
    assert_eq!(run("07/03/1985", Policy::Year), REDACTED);
    assert_eq!(run("07/03/1985", age_band(10, "2026-01-01")), REDACTED);
    assert_eq!(run("twelve", Policy::Bucket { width: 10 }), REDACTED);
    assert_eq!(run("5", Policy::Bucket { width: 0 }), REDACTED);
}

#[test]
fn generalisation_blank_cells_pass_through_untouched() {
    for p in [
        Policy::Year,
        age_band(10, "2026-01-01"),
        Policy::Bucket { width: 10 },
    ] {
        for blank in ["", " ", "\t ", "  \n"] {
            assert_eq!(run(blank, p), blank, "{p} {blank:?}");
        }
    }
}

#[test]
fn age_band_without_reference_date_is_an_error_not_the_clock() {
    let p = Policy::from_str("age-band").unwrap();
    assert!(matches!(
        apply("1990-01-01", p, None, 16),
        Err(Error::MissingReferenceDate)
    ));
    assert_eq!(apply("", p, None, 16).unwrap(), "");
}

#[test]
fn with_params_rejects_misplaced_and_zero_parameters() {
    let d: Date = "2026-01-01".parse().unwrap();
    assert!(Policy::Year.with_params(Some(5), None).is_err());
    assert!(Policy::Year.with_params(None, Some(d)).is_err());
    assert!(Policy::Hash.with_params(Some(5), None).is_err());
    assert!(Policy::Bucket { width: 10 }
        .with_params(None, Some(d))
        .is_err());
    assert!(Policy::Bucket { width: 10 }
        .with_params(Some(0), None)
        .is_err());
    assert_eq!(
        Policy::Bucket { width: 10 }
            .with_params(Some(5), None)
            .unwrap(),
        Policy::Bucket { width: 5 }
    );
    assert_eq!(Policy::Year.with_params(None, None).unwrap(), Policy::Year);
}

#[test]
fn generalisation_needs_no_key_material() {
    for p in [
        Policy::Year,
        age_band(10, "2026-01-01"),
        Policy::Bucket { width: 3 },
    ] {
        assert_eq!(p.key_material(), KeyMaterial::None);
        assert!(p.is_generalisation());
    }
    assert!(!Policy::Hash.is_generalisation());
}

#[test]
fn email_mask_is_character_boundary_safe() {
    let m = |v: &str| mask(v, MaskKind::Email);
    assert_eq!(m("alice@x.com"), "a****@x.com");
    assert_eq!(m("ab@x.com"), "a*@x.com");
    assert_eq!(m("élodie@x.com"), "é*****@x.com");
    assert_eq!(m("日本語@x.jp"), "日**@x.jp");
    assert_eq!(m("😀ab@x.com"), "😀**@x.com");
    assert_eq!(m("bob@exämple.de"), "b**@exämple.de");
    assert_eq!(m("bob@münchen.de"), "b**@münchen.de");
    assert_eq!(m("a@x.com"), "*@x.com");
    assert_eq!(m("é@x.com"), "*@x.com");
    assert_eq!(m("@x.com"), "*@x.com");
    assert_eq!(m("élodie"), "[INVALID EMAIL]");
    assert_eq!(m("plain"), "[INVALID EMAIL]");
    assert_eq!(m(""), "");
    assert_eq!(mask("élodie@x.com", MaskKind::Auto), "é*****@x.com");
}
