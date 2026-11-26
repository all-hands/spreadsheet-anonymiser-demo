use crate::*;
use wasm_bindgen_test::wasm_bindgen_test;

#[wasm_bindgen_test]
fn parse_policy_rejects_unknown() {
    assert!(parse_policy("keep").is_ok());
    assert!(parse_policy("nope").is_err());
}

#[wasm_bindgen_test]
fn typed_scoped_base32_matches_core() {
    let salt = [7u8; SALT_LEN];
    let root = anonymiser_core::derive_root_key_raw(b"k", &salt);
    let session = Session {
        root,
        salt: salt.to_vec(),
    };
    let scoped = session.column_key_scoped("customers", "email").unwrap();
    assert_eq!(
        anonymiser_core::column_key_scoped(&session.root, &salt, "customers", "email").unwrap()[..],
        scoped[..]
    );

    let via_facade = apply_policy_keyed_typed(
        " Jane.Doe+tag@GMAIL.com ",
        "hash",
        &scoped,
        DEFAULT_TOKEN_BYTES,
        "email",
    )
    .unwrap();
    let via_core = apply_typed(
        " Jane.Doe+tag@GMAIL.com ",
        Policy::Hash,
        Some(&scoped),
        DEFAULT_TOKEN_BYTES,
        CanonType::Email,
    )
    .unwrap();
    assert_eq!(via_facade, via_core);
    assert_eq!(
        reencode_token_str(&via_facade, "hash", "base32").unwrap(),
        reencode_token(&via_facade, Policy::Hash, TokenEncoding::Base32)
    );
    let unscoped = session.column_key("email").unwrap();
    assert_ne!(unscoped[..], scoped[..]);

    assert!(parse_canon_type("nope").is_err());
    assert!(parse_token_encoding("nope").is_err());
}

#[wasm_bindgen_test]
fn vocabulary_round_trips_through_the_facade() {
    for s in anonymiser_core::POLICY_VOCABULARY {
        let p = parse_policy(s).unwrap_or_else(|e| panic!("policy {s:?}: {e:?}"));
        assert_eq!(p.to_string(), *s, "spelling drift for {s:?}");
        assert_eq!(
            parse_policy(&p.to_string()).unwrap(),
            p,
            "round trip for {s:?}"
        );
    }
    for s in anonymiser_core::CANON_TYPE_VOCABULARY {
        let ty = parse_canon_type(s).unwrap_or_else(|e| panic!("canon type {s:?}: {e:?}"));
        assert_eq!(ty.to_string(), *s, "spelling drift for {s:?}");
        assert_eq!(
            parse_canon_type(&ty.to_string()).unwrap(),
            ty,
            "round trip for {s:?}"
        );
    }
    for s in anonymiser_core::TOKEN_ENCODING_VOCABULARY {
        let enc = parse_token_encoding(s).unwrap_or_else(|e| panic!("token encoding {s:?}: {e:?}"));
        assert_eq!(enc.to_string(), *s, "spelling drift for {s:?}");
        assert_eq!(
            parse_token_encoding(&enc.to_string()).unwrap(),
            enc,
            "round trip for {s:?}"
        );
    }
}

#[wasm_bindgen_test]
fn apply_entries_refuse_kyber_aes() {
    let key = [5u8; 64];
    assert!(apply_policy("Jane Doe", "kyber-aes").is_err());
    assert!(apply_policy("", "kyber-aes").is_err());
    assert!(apply_policy_keyed("Jane Doe", "kyber-aes", &key, DEFAULT_TOKEN_BYTES).is_err());
    assert!(apply_policy_keyed_typed("Jane Doe", "kyber-aes", &key, 16, "auto").is_err());
    assert!(apply_policy_generalised("Jane Doe", "kyber-aes", None, None).is_err());
    assert!(apply_policy_legacy("Jane Doe", "kyber-aes", b"old").is_err());
    assert_eq!(policy_key_material("kyber-aes").unwrap(), "column");
    assert!(policy_vocabulary().contains(&"kyber-aes".to_string()));
    assert_eq!(
        deprecated_policy_vocabulary(),
        vec!["kyber-aes".to_string()]
    );
    let cell = anonymiser_core::kyber_encrypt_cell("Jane Doe", &key).unwrap();
    assert_eq!(decrypt_value(&cell, &key).unwrap(), "Jane Doe");
}

#[test]
fn kyber_aes_refusal_is_the_core_notice() {
    let err = apply_generalised("Jane Doe", "kyber-aes", None, None).unwrap_err();
    assert!(matches!(err, Error::DeprecatedPolicy(_)), "{err}");
    assert_eq!(
        err.to_string(),
        Policy::KyberAes.deprecation_notice().unwrap()
    );
    assert_eq!(anonymiser_core::DEPRECATED_POLICY_VOCABULARY, ["kyber-aes"]);
}

#[test]
fn parse_error_text_is_the_core_display() {
    assert_eq!(
        Policy::from_str("zap").unwrap_err().to_string(),
        "unknown policy \"zap\""
    );
    assert_eq!(
        CanonType::from_str("date").unwrap_err().to_string(),
        "unknown canon type \"date\" (auto|text|email|phone|id)"
    );
    assert_eq!(
        TokenEncoding::from_str("md5").unwrap_err().to_string(),
        "unknown token encoding \"md5\" (hex|base32)"
    );
}

#[test]
fn decrypt_any_value_matches_core_dispatch() {
    let salt = [7u8; SALT_LEN];
    let session = Session {
        root: anonymiser_core::derive_root_key_raw(b"k", &salt),
        salt: salt.to_vec(),
    };
    let col_key = session.column_key("email").unwrap();
    let legacy = b"old-key".to_vec();

    let enc = anonymiser_core::encrypt_cell("Jane Doe", &col_key, &[42u8; 12]).unwrap();
    let kyber = anonymiser_core::kyber_encrypt_cell("Jane Doe", &col_key).unwrap();
    let old_enc = anonymiser_core::legacy_encrypt_cell("Jane Doe", b"old-key", false).unwrap();
    let old_qenc = anonymiser_core::legacy_encrypt_cell("Jane Doe", b"old-key", true).unwrap();

    assert_eq!(
        decrypt_any_value(&enc, Some(col_key.clone()), None).unwrap(),
        "Jane Doe"
    );
    assert_eq!(
        decrypt_any_value(&kyber, Some(col_key.clone()), Some(legacy.clone())).unwrap(),
        "Jane Doe"
    );
    assert_eq!(
        decrypt_any_value(&old_enc, None, Some(legacy.clone())).unwrap(),
        "Jane Doe"
    );
    assert_eq!(
        decrypt_any_value(&old_qenc, Some(col_key.clone()), Some(legacy.clone())).unwrap(),
        "Jane Doe"
    );
    assert_eq!(
        decrypt_any_value("plain", Some(col_key), Some(legacy)).unwrap(),
        "plain"
    );
}

#[test]
fn session_from_master_key_validates_the_envelope() {
    let salt = [7u8; SALT_LEN];
    let env = anonymiser_core::wrap_master_key(&[5u8; 64]).unwrap();
    let session = session_from_master_key(&env, &salt).expect("valid envelope");
    let expected = anonymiser_core::derive_root_key_raw(&[5u8; 64], &salt);
    assert_eq!(
        session.column_key("email").unwrap()[..],
        anonymiser_core::column_key(&expected, &salt, "email").unwrap()[..]
    );

    let mut corrupt = env.clone();
    let last = corrupt.len() - 1;
    corrupt[last] ^= 0xff;
    assert!(matches!(
        session_from_envelope(&corrupt, &salt),
        Err(Error::KeyChecksum)
    ));

    assert!(matches!(
        session_from_envelope(&[9u8; 64], &salt),
        Err(Error::KeyLen(64))
    ));

    let mut foreign = env.clone();
    foreign[0] = b'X';
    assert!(matches!(
        session_from_envelope(&foreign, &salt),
        Err(Error::NotAKeyFile)
    ));
}

#[wasm_bindgen_test]
fn generalised_export_matches_helper_and_rejects() {
    let r = || Some("2026-01-01".to_string());
    assert_eq!(
        apply_policy_generalised("1996-01-01", "age-band", None, r()).unwrap(),
        "30-39"
    );
    assert_eq!(
        apply_policy_generalised("27", "bucket", Some(5), None).unwrap(),
        "25-29"
    );
    assert_eq!(
        apply_policy_generalised("nope", "year", None, None).unwrap(),
        "[REDACTED]"
    );
    assert!(apply_policy_generalised("1996-01-01", "age-band", None, None).is_err());
    assert!(apply_policy_generalised("1", "year", Some(5), None).is_err());
}

#[test]
fn generalised_policies_match_the_cli_vectors() {
    let g = |v: &str, p: &str, w: Option<u32>, r: Option<&str>| apply_generalised(v, p, w, r);
    let r = Some("2026-01-01");
    assert_eq!(g("1996-01-01", "age-band", None, r).unwrap(), "30-39");
    assert_eq!(g("1996-01-02", "age-band", None, r).unwrap(), "20-29");
    assert_eq!(g("1930-05-05", "age-band", None, r).unwrap(), "90+");
    assert_eq!(g("1996-01-01", "age-band", Some(5), r).unwrap(), "30-34");
    assert_eq!(g("2021/06/30", "year", None, None).unwrap(), "2021");
    assert_eq!(g("27", "bucket", Some(5), None).unwrap(), "25-29");
    assert_eq!(g("9.8", "bucket", Some(5), None).unwrap(), "5-9");
    assert_eq!(g("-3", "bucket", Some(5), None).unwrap(), "-5--1");
    assert_eq!(g("27", "bucket", None, None).unwrap(), "20-29");
    assert_eq!(g("07/03/1985", "age-band", None, r).unwrap(), "[REDACTED]");
    assert_eq!(g("twelve", "bucket", None, None).unwrap(), "[REDACTED]");
    assert_eq!(g(" ", "year", None, None).unwrap(), " ");
    assert_eq!(g("", "bucket", None, None).unwrap(), "");
    assert!(matches!(
        g("1996-01-01", "age-band", None, None),
        Err(Error::MissingReferenceDate)
    ));
    assert!(g("1996-01-01", "age-band", None, Some("01/01/2026")).is_err());
    assert!(g("1996-01-01", "year", Some(5), None).is_err());
    assert!(g("5", "bucket", Some(0), None).is_err());
    assert!(g("5", "bucket", None, Some("2026-01-01")).is_err());
    let via_core = anonymiser_core::apply(
        "1996-01-01",
        Policy::from_str("age-band")
            .unwrap()
            .with_params(None, Some("2026-01-01".parse().unwrap()))
            .unwrap(),
        None,
        DEFAULT_TOKEN_BYTES,
    )
    .unwrap();
    assert_eq!(via_core, g("1996-01-01", "age-band", None, r).unwrap());
}

#[test]
fn vocabulary_round_trips_via_core_reexports() {
    for s in anonymiser_core::POLICY_VOCABULARY {
        let p = Policy::from_str(s).unwrap_or_else(|e| panic!("policy {s:?}: {e}"));
        assert_eq!(p.to_string(), *s, "spelling drift for {s:?}");
        assert_eq!(Policy::from_str(&p.to_string()).unwrap(), p);
    }
    for s in anonymiser_core::CANON_TYPE_VOCABULARY {
        let ty = CanonType::from_str(s).unwrap_or_else(|e| panic!("canon type {s:?}: {e}"));
        assert_eq!(ty.to_string(), *s, "spelling drift for {s:?}");
        assert_eq!(CanonType::from_str(&ty.to_string()).unwrap(), ty);
    }
    for s in anonymiser_core::TOKEN_ENCODING_VOCABULARY {
        let enc =
            TokenEncoding::from_str(s).unwrap_or_else(|e| panic!("token encoding {s:?}: {e}"));
        assert_eq!(enc.to_string(), *s, "spelling drift for {s:?}");
        assert_eq!(TokenEncoding::from_str(&enc.to_string()).unwrap(), enc);
    }
}

#[wasm_bindgen_test]
fn ephemeral_sessions_are_independent_and_self_consistent() {
    let a = session_ephemeral();
    let b = session_ephemeral();
    let ka = a.column_key("email").unwrap();
    assert_eq!(ka, a.column_key("email").unwrap(), "same run, same key");
    assert_ne!(
        ka,
        b.column_key("email").unwrap(),
        "different run, different key"
    );
    assert_ne!(ka, a.column_key("name").unwrap(), "columns are separated");

    let token = |s: &Session, v: &str| {
        let key = s.column_key("email").unwrap();
        anonymiser_core::apply(v, Policy::Hash, Some(&key), DEFAULT_TOKEN_BYTES).unwrap()
    };
    assert_eq!(token(&a, "x@y.com"), token(&a, "x@y.com"));
    assert_ne!(token(&a, "x@y.com"), token(&b, "x@y.com"));
}

#[test]
fn ephemeral_session_draws_secret_and_salt_from_the_rng() {
    struct StepRng(u64, u64);
    impl StepRng {
        fn new(start: u64, inc: u64) -> Self {
            Self(start, inc)
        }
    }
    impl rand_core::TryRng for StepRng {
        type Error = rand_core::Infallible;
        fn try_next_u32(&mut self) -> Result<u32, Self::Error> {
            self.try_next_u64().map(|v| v as u32)
        }
        fn try_next_u64(&mut self) -> Result<u64, Self::Error> {
            let v = self.0;
            self.0 = self.0.wrapping_add(self.1);
            Ok(v)
        }
        fn try_fill_bytes(&mut self, dst: &mut [u8]) -> Result<(), Self::Error> {
            for chunk in dst.chunks_mut(8) {
                let v = self.try_next_u64()?.to_le_bytes();
                chunk.copy_from_slice(&v[..chunk.len()]);
            }
            Ok(())
        }
    }
    let a = ephemeral_session(&mut StepRng::new(1, 3));
    let b = ephemeral_session(&mut StepRng::new(1, 3));
    let c = ephemeral_session(&mut StepRng::new(2, 3));
    assert_eq!(a.salt.len(), SALT_LEN);
    assert_eq!(a.column_key("k").unwrap(), b.column_key("k").unwrap());
    assert_ne!(a.column_key("k").unwrap(), c.column_key("k").unwrap());
    let (r1, r2) = (session_ephemeral(), session_ephemeral());
    assert_ne!(r1.column_key("k").unwrap(), r2.column_key("k").unwrap());
}

#[wasm_bindgen_test]
fn key_material_vocabulary_is_pinned() {
    assert_eq!(
        key_material_vocabulary(),
        vec![
            "none".to_string(),
            "column".to_string(),
            "passphrase".to_string()
        ]
    );
    for p in anonymiser_core::POLICY_VOCABULARY {
        assert!(key_material_vocabulary().contains(&policy_key_material(p).unwrap()));
    }
}

#[test]
fn column_key_and_token_guards() {
    assert!(check_column_key(&[1u8; 64]).is_ok());
    for n in [0usize, 1, 32, 63, 65, 4096] {
        assert!(check_column_key(&vec![1u8; n]).is_err(), "len {n}");
    }
    let tok = anonymiser_core::hash_cell("x", &[1u8; 64], 16).unwrap();
    assert!(check_hash_token(&tok).is_ok());
    assert!(check_hash_token(&"a".repeat(128)).is_ok());
    for bad in ["abc", "zz", "AB", "ab cd", &"a".repeat(130), "é1"] {
        assert!(check_hash_token(bad).is_err(), "{bad:?}");
    }
}
