mod anonymity;
mod canon;
mod cell;
mod error;
mod generalise;
mod keys;
mod kyber;
mod legacy;
mod mapping;
mod policy;
mod table;
mod token;

pub use anonymity::{
    measure_rows, suppress_small_groups, AnonymityError, ColumnContribution, Measurer, Report,
    SuppressMode, Suppression, MIN_K, SUPPRESSED, SUPPRESS_MODE_VOCABULARY,
};
pub use canon::{canonicalize, canonicalize_typed, CanonType, CANON_TYPE_VOCABULARY};
pub use cell::{decrypt_any, decrypt_cell, encrypt_cell, is_encrypted, ENC_PREFIX};
pub use generalise::{age_band, bucket, parse_cell_date, year_of, Date, AGE_TOP, DEFAULT_WIDTH};
pub use keys::{
    column_key, column_key_scoped, derive_root_key, derive_root_key_raw, key_fingerprint,
    parse_master_key, wrap_master_key, MasterKeyFile, Profile, RootKey, KEY_FILE_LEN, KEY_MAGIC,
    KEY_VERSION, MASTER_KEY_LEN, SALT_LEN,
};
pub use kyber::{kyber_decrypt_cell, kyber_encrypt_cell, KYBER_PREFIX};
pub use legacy::{
    legacy_decrypt_cell, legacy_encrypt_cell, legacy_hmac_sha256, legacy_mask, legacy_sha256,
    LEGACY_ENC_PREFIX, LEGACY_QENC_PREFIX,
};
pub use mapping::{
    mapping_key, open_mapping_value, seal_mapping_value, MAPPING_KEY_LEN, MAPPING_NONCE_LEN,
};
pub use policy::{
    apply, apply_typed, faux, mask, reencode_token, KeyMaterial, MaskKind, Policy,
    DEPRECATED_POLICY_VOCABULARY, POLICY_VOCABULARY, REDACTED,
};
pub use table::{Row, RowSink, TableDecoder, TableEncoder, TableError, TableFormat};
pub use token::{
    encode_token, hash_cell, hash_cell_unkeyed, TokenEncoding, DEFAULT_TOKEN_BYTES,
    MAX_TOKEN_BYTES, TOKEN_ENCODING_VOCABULARY,
};

pub use error::Error;

#[cfg(test)]
mod tests {
    use super::*;

    fn fast_profile() -> Profile {
        Profile {
            iters: 1,
            memory_kb: 16,
            threads: 1,
        }
    }

    #[test]
    fn mask_kinds() {
        assert_eq!(
            mask("alice@example.com", MaskKind::Email),
            "a****@example.com"
        );
        assert_eq!(
            mask("alice@example.com", MaskKind::Auto),
            "a****@example.com"
        );
        assert_eq!(mask("+44 161 555 1234", MaskKind::Auto), "************1234");
        assert_eq!(mask("Alice Smith", MaskKind::Auto), REDACTED);
        assert_eq!(
            mask("4111111111111111", MaskKind::Last4),
            "************1111"
        );
        assert_eq!(mask("ab", MaskKind::Email), "[INVALID EMAIL]");
        assert_eq!(mask("a@x.com", MaskKind::Email), "*@x.com");
    }

    #[test]
    fn faux_kinds() {
        assert_eq!(faux("bob@x.io"), "faux_user@example.com");
        assert_eq!(faux("210-555-1234"), "0000000000");
        assert_eq!(faux("Bob"), "FAUX_DATA");
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = [5u8; 64];
        let nonce = [42u8; 12];
        let enc = encrypt_cell("Jane Doe", &key, &nonce).unwrap();
        assert!(enc.starts_with("enc:v1:"), "got {enc}");
        assert_eq!(decrypt_cell(&enc, &key).unwrap(), "Jane Doe");

        assert!(matches!(
            decrypt_cell(&enc, &[6u8; 64]),
            Err(Error::DecryptFailed)
        ));
        assert!(matches!(
            decrypt_cell("plain", &key),
            Err(Error::NotEncrypted)
        ));
        assert!(matches!(
            apply("x", Policy::Encrypt, None, DEFAULT_TOKEN_BYTES),
            Err(Error::MissingKey)
        ));

        assert_eq!(encrypt_cell("Jane Doe", &key, &nonce).unwrap(), enc);
    }

    #[test]
    fn canonicalize_variants() {
        assert_eq!(canonicalize("  John   SMITH "), "john smith");
        assert_eq!(canonicalize("A.B@gmail.com"), "ab@gmail.com");
        assert_eq!(canonicalize("A.B@googlemail.com"), "ab@googlemail.com");
        assert_eq!(canonicalize("+44 (161) 555-1234"), "+441615551234");
    }

    #[test]
    fn root_key_is_deterministic_and_salt_sensitive() {
        let master = [7u8; 64];
        let salt_a = [1u8; 32];
        let salt_b = [2u8; 32];
        let p = fast_profile();

        let r1 = derive_root_key(&master, &salt_a, p).unwrap();
        let r2 = derive_root_key(&master, &salt_a, p).unwrap();
        let r3 = derive_root_key(&master, &salt_b, p).unwrap();

        assert_eq!(r1.as_bytes(), r2.as_bytes());
        assert_ne!(r1.as_bytes(), r3.as_bytes());
    }

    #[test]
    fn column_keys_diverge_by_name() {
        let root = derive_root_key(&[7u8; 64], &[1u8; 32], fast_profile()).unwrap();
        let k1 = column_key(&root, &[1u8; 32], "email").unwrap();
        let k1b = column_key(&root, &[1u8; 32], "email").unwrap();
        let k2 = column_key(&root, &[1u8; 32], "phone").unwrap();
        assert_eq!(k1, k1b);
        assert_ne!(k1, k2);
    }

    #[test]
    fn scoped_keys_separate_datasets_and_v1() {
        let salt = [1u8; 32];
        let root = derive_root_key(&[7u8; 64], &salt, fast_profile()).unwrap();
        let v1 = column_key(&root, &salt, "email").unwrap();
        let a = column_key_scoped(&root, &salt, "customers-2026", "email").unwrap();
        let a2 = column_key_scoped(&root, &salt, "customers-2026", "email").unwrap();
        let b = column_key_scoped(&root, &salt, "staff-2026", "email").unwrap();
        let a_other_col = column_key_scoped(&root, &salt, "customers-2026", "phone").unwrap();
        assert_eq!(a, a2);
        assert_ne!(a, b);
        assert_ne!(a, v1);
        assert_ne!(a, a_other_col);
    }

    #[test]
    fn groups_share_one_token_namespace() {
        let salt = [1u8; 32];
        let root = derive_root_key(&[9u8; 64], &salt, fast_profile()).unwrap();
        let g1 = column_key(&root, &salt, "colours").unwrap();
        let g2 = column_key(&root, &salt, "colours").unwrap();
        assert_eq!(g1, g2);
        assert_eq!(
            hash_cell("red", &g1, DEFAULT_TOKEN_BYTES).unwrap(),
            hash_cell("red", &g2, DEFAULT_TOKEN_BYTES).unwrap()
        );
        assert_ne!(
            hash_cell("red", &g1, DEFAULT_TOKEN_BYTES).unwrap(),
            hash_cell("blue", &g1, DEFAULT_TOKEN_BYTES).unwrap()
        );
    }

    #[test]
    fn apply_keep_redact_empty() {
        assert_eq!(
            apply("x", Policy::Keep, None, DEFAULT_TOKEN_BYTES).unwrap(),
            "x"
        );
        assert_eq!(
            apply("x", Policy::Redact, None, DEFAULT_TOKEN_BYTES).unwrap(),
            REDACTED
        );
        assert_eq!(
            apply("", Policy::Redact, None, DEFAULT_TOKEN_BYTES).unwrap(),
            ""
        );
        assert_eq!(
            apply("   ", Policy::Hash, Some(&[0u8; 64]), DEFAULT_TOKEN_BYTES).unwrap(),
            ""
        );
        assert_eq!(
            apply("", Policy::Hash, Some(&[0u8; 64]), DEFAULT_TOKEN_BYTES).unwrap(),
            ""
        );
    }

    #[test]
    fn hash_unkeyed_matches_legacy_sha256() {
        assert_eq!(
            hash_cell_unkeyed("student01"),
            "0be117d5582e282b966b278642c9104dbe6d494fffcd99b15a136d4a816c4b1c"
        );
    }

    #[test]
    fn keyed_hash_is_canonicalizing() {
        let root = derive_root_key(&[7u8; 64], &[1u8; 32], fast_profile()).unwrap();
        let k = column_key(&root, &[1u8; 32], "name").unwrap();
        let a = apply(
            "  John   Smith ",
            Policy::Hash,
            Some(&k),
            DEFAULT_TOKEN_BYTES,
        )
        .unwrap();
        let b = apply("john smith", Policy::Hash, Some(&k), DEFAULT_TOKEN_BYTES).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), DEFAULT_TOKEN_BYTES * 2);
    }

    #[test]
    fn kyber_roundtrip_deterministic_and_key_bound() {
        let key = [9u8; 64];
        let enc = kyber_encrypt_cell("Jane Doe", &key).unwrap();
        assert!(enc.starts_with("kyber:v1:"), "got {enc}");
        let b64_len = (1088usize + 7 + 16).div_ceil(3) * 4;
        assert_eq!(enc.len(), "kyber:v1:".len() + b64_len, "cell {enc}");

        assert_eq!(kyber_encrypt_cell("Jane Doe", &key).unwrap(), enc);
        assert_ne!(kyber_encrypt_cell("John Doe", &key).unwrap(), enc);
        let other = kyber_encrypt_cell("Jane Doe", &[8u8; 64]).unwrap();
        assert_ne!(other, enc);
        assert_eq!(kyber_decrypt_cell(&enc, &key).unwrap(), "Jane Doe");
        assert!(matches!(
            kyber_decrypt_cell(&enc, &[8u8; 64]),
            Err(Error::DecryptFailed)
        ));
        assert!(matches!(
            kyber_decrypt_cell("plain", &key),
            Err(Error::NotEncrypted)
        ));
    }

    #[test]
    fn kyber_aes_is_refused_by_the_engine() {
        let key = [9u8; 64];
        for (value, k) in [
            ("jane@x.io", Some(&key[..])),
            ("", Some(&key[..])),
            ("x", None),
        ] {
            let err = apply(value, Policy::KyberAes, k, DEFAULT_TOKEN_BYTES).unwrap_err();
            assert!(
                matches!(err, Error::DeprecatedPolicy(_)),
                "{value:?}: {err}"
            );
            let msg = err.to_string();
            assert!(msg.contains("deprecated"), "{msg}");
            assert!(msg.contains("\"encrypt\""), "{msg}");
        }
        let err = apply_typed("x", Policy::KyberAes, Some(&key), 16, CanonType::Email);
        assert!(matches!(err, Err(Error::DeprecatedPolicy(_))));
    }

    #[test]
    fn legacy_sha256_and_hmac_match_pinned_vectors() {
        assert_eq!(legacy_sha256("student01"), "0be117d5582e282b");
        assert_eq!(legacy_sha256(""), "e3b0c44298fc1c14");

        let mac = legacy_hmac_sha256("The quick brown fox jumps over the lazy dog", b"key");
        assert_eq!(mac, "f7bc83f430538424");
        assert_ne!(legacy_hmac_sha256("a", b""), legacy_hmac_sha256("b", b""));
    }

    #[test]
    fn legacy_mask_matches_pinned_vectors() {
        assert_eq!(legacy_mask("John Doe"), "J******e");
        assert_eq!(legacy_mask("07700900456"), "0*********6");
        assert_eq!(legacy_mask(""), "");
        assert_eq!(legacy_mask("a"), "*");
        assert_eq!(legacy_mask("ab"), "**");
        assert_eq!(legacy_mask("abc"), "a*c");
    }

    #[test]
    fn legacy_encrypt_decrypt_roundtrip() {
        let key = b"old-global-key";
        for quantum in [false, true] {
            let enc = legacy_encrypt_cell("Jane Doe", key, quantum).unwrap();
            let prefix = if quantum { "qenc:" } else { "enc:" };
            assert!(enc.starts_with(prefix), "got {enc}");
            assert_eq!(legacy_decrypt_cell(&enc, key).unwrap(), "Jane Doe");
            assert!(matches!(
                legacy_decrypt_cell(&enc, b"wrong"),
                Err(Error::DecryptFailed)
            ));
            assert_ne!(legacy_encrypt_cell("Jane Doe", key, quantum).unwrap(), enc);
        }
        assert!(matches!(
            legacy_decrypt_cell("plain", key),
            Err(Error::NotEncrypted)
        ));
    }

    #[test]
    fn key_material_classification() {
        assert_eq!(Policy::Keep.key_material(), KeyMaterial::None);
        assert_eq!(Policy::Hash.key_material(), KeyMaterial::ColumnKey);
        assert_eq!(Policy::KyberAes.key_material(), KeyMaterial::ColumnKey);
        assert_eq!(Policy::LegacyAes.key_material(), KeyMaterial::Passphrase);
        assert_eq!(
            Policy::LegacyHmacSha256.key_material(),
            KeyMaterial::Passphrase
        );
        assert_eq!(Policy::LegacyMask.key_material(), KeyMaterial::None);
    }

    #[test]
    fn is_encrypted_detects_all_cell_formats() {
        assert!(is_encrypted("enc:v1:AAAA"));
        assert!(is_encrypted("kyber:v1:AAAA"));
        assert!(is_encrypted("enc:AAAA"));
        assert!(is_encrypted("qenc:AAAA"));
        assert!(!is_encrypted("plain"));
    }
}
