use anonymiser_core::Error;

fn pinned() -> Vec<(Error, &'static str)> {
    vec![
        (Error::Argon2Params, "invalid Argon2 parameters"),
        (Error::Argon2Derive, "Argon2 derivation failed"),
        (Error::HkdfExpand, "HKDF expand failed"),
        (
            Error::MissingKey,
            "policy requires a keyed session (passphrase)",
        ),
        (
            Error::MissingDecryptKey,
            "ciphertext cell has no key material (column key for enc:v1:/kyber:v1:, the old global key for enc:/qenc:)",
        ),
        (
            Error::DecryptFailed,
            "decryption failed (wrong key or corrupted data)",
        ),
        (Error::NotEncrypted, "value is not in enc:v1: format"),
        (
            Error::TokenBytes(0),
            "token length 0 out of range 1..=64 bytes",
        ),
        (
            Error::TokenBytes(65),
            "token length 65 out of range 1..=64 bytes",
        ),
        (Error::KeyLen(31), "master-key file has wrong length 31"),
        (
            Error::NotAKeyFile,
            "not a master-key file (missing CSVANON magic) \u{2014} run `anonymiser keygen`",
        ),
        (
            Error::KeyVersion(7),
            "unsupported master-key envelope version 7",
        ),
        (
            Error::KeyChecksum,
            "master-key envelope corrupt (checksum mismatch)",
        ),
        (
            Error::UnknownPolicy("shred".into()),
            "unknown policy \"shred\"",
        ),
        (
            Error::UnknownPolicy("quo\"te\n\u{e9}".into()),
            "unknown policy \"quo\\\"te\\n\u{e9}\"",
        ),
        (
            Error::UnknownCanonType("nope".into()),
            "unknown canon type \"nope\" (auto|text|email|phone|id)",
        ),
        (
            Error::UnknownTokenEncoding("base64".into()),
            "unknown token encoding \"base64\" (hex|base32)",
        ),
        (
            Error::MissingReferenceDate,
            "age-band needs a reference date (yyyy-mm-dd): output must not depend on today's date",
        ),
        (
            Error::InvalidParam("width must be positive".into()),
            "width must be positive",
        ),
        (
            Error::InvalidParam("{braces} stay {literal}".into()),
            "{braces} stay {literal}",
        ),
        (
            Error::NulInKeyName,
            "dataset/column names must not contain NUL bytes",
        ),
        (Error::DeprecatedPolicy("the notice"), "the notice"),
    ]
}

#[test]
fn every_variant_display_text_is_pinned() {
    for (err, want) in pinned() {
        assert_eq!(err.to_string(), want, "{err:?}");
    }
}

#[test]
fn errors_are_std_errors_without_a_source() {
    for (err, _) in pinned() {
        let as_std: &dyn std::error::Error = &err;
        assert!(as_std.source().is_none(), "{err:?}");
    }
}

#[test]
fn kyber_aes_deprecation_notice_is_pinned() {
    let notice = anonymiser_core::Policy::KyberAes
        .deprecation_notice()
        .expect("kyber-aes is deprecated");
    assert_eq!(
        notice,
        "policy \"kyber-aes\" is deprecated and refused for new runs: its ML-KEM layer is keyed from the column key, so it adds no protection over AES-256-GCM; use \"encrypt\" instead (existing kyber:v1: cells still decrypt)"
    );
    assert_eq!(Error::DeprecatedPolicy(notice).to_string(), notice);
}
