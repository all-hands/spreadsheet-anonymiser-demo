use blake2::digest::Mac;
use blake2::Blake2bMac512;
use data_encoding::BASE32_NOPAD;
use sha2::{Digest, Sha256};
use std::fmt;
use std::str::FromStr;

use crate::Error;

pub const DEFAULT_TOKEN_BYTES: usize = 16;

pub const MAX_TOKEN_BYTES: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum TokenEncoding {
    #[default]
    Hex,
    Base32,
}

const HEX_LOWER: &[u8; 16] = b"0123456789abcdef";
const BASE32_LOWER: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";

pub const TOKEN_ENCODING_VOCABULARY: &[&str] = &["hex", "base32"];

impl TokenEncoding {
    pub fn as_str(self) -> &'static str {
        match self {
            TokenEncoding::Hex => "hex",
            TokenEncoding::Base32 => "base32",
        }
    }

    pub fn token_char_len(self, token_bytes: usize) -> usize {
        match self {
            TokenEncoding::Hex => 2 * token_bytes,
            TokenEncoding::Base32 => (token_bytes * 8).div_ceil(5),
        }
    }

    pub fn valid_token_shape(self, s: &str, token_bytes: usize) -> bool {
        let alphabet: &[u8] = match self {
            TokenEncoding::Hex => HEX_LOWER,
            TokenEncoding::Base32 => BASE32_LOWER,
        };
        s.len() == self.token_char_len(token_bytes) && s.bytes().all(|b| alphabet.contains(&b))
    }
}

impl FromStr for TokenEncoding {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "hex" => Ok(TokenEncoding::Hex),
            "base32" => Ok(TokenEncoding::Base32),
            other => Err(Error::UnknownTokenEncoding(other.to_string())),
        }
    }
}

impl fmt::Display for TokenEncoding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

pub fn encode_token(bytes: &[u8], encoding: TokenEncoding) -> String {
    match encoding {
        TokenEncoding::Hex => hex::encode(bytes),
        TokenEncoding::Base32 => BASE32_NOPAD.encode(bytes).to_ascii_lowercase(),
    }
}

pub fn hash_cell(value: &str, col_key: &[u8], token_bytes: usize) -> Result<String, Error> {
    if !(1..=MAX_TOKEN_BYTES).contains(&token_bytes) {
        return Err(Error::TokenBytes(token_bytes));
    }
    let mut mac = <Blake2bMac512 as blake2::digest::KeyInit>::new_from_slice(col_key)
        .expect("BLAKE2b-512 accepts keys up to 64 bytes");
    mac.update(value.as_bytes());
    Ok(hex::encode(&mac.finalize().into_bytes()[..token_bytes]))
}

pub fn hash_cell_unkeyed(value: &str) -> String {
    let mut h = Sha256::new();
    h.update(value.as_bytes());
    hex::encode(h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vocabulary_round_trips() {
        for s in TOKEN_ENCODING_VOCABULARY {
            let enc =
                TokenEncoding::from_str(s).unwrap_or_else(|e| panic!("vocabulary {s:?}: {e}"));
            assert_eq!(enc.as_str(), *s, "spelling drift for {s:?}");
            assert_eq!(enc.to_string(), *s);
            assert_eq!(TokenEncoding::from_str(&enc.to_string()).unwrap(), enc);
        }
        assert!(TokenEncoding::from_str("nope").is_err());
    }

    #[test]
    fn truncation_bounds() {
        let key = [1u8; 64];
        let full = hash_cell("v", &key, 64).unwrap();
        assert_eq!(full.len(), 128);
        for n in [1usize, 8, 16, 32] {
            let t = hash_cell("v", &key, n).unwrap();
            assert_eq!(t.len(), n * 2);
            assert!(full.starts_with(&t), "n={n}");
        }
        assert!(matches!(hash_cell("v", &key, 0), Err(Error::TokenBytes(0))));
        assert!(matches!(
            hash_cell("v", &key, MAX_TOKEN_BYTES + 1),
            Err(Error::TokenBytes(65))
        ));
    }

    #[test]
    fn base32_matches_rfc4648_vectors_unpadded() {
        for (bytes, expect) in [
            (&b"f"[..], "my"),
            (b"fo", "mzxq"),
            (b"foo", "mzxw6"),
            (b"foob", "mzxw6yq"),
            (b"fooba", "mzxw6ytb"),
            (b"foobar", "mzxw6ytboi"),
        ] {
            assert_eq!(encode_token(bytes, TokenEncoding::Base32), expect);
        }
        assert_eq!(encode_token(b"f", TokenEncoding::Hex), "66");
    }

    #[test]
    fn base32_pinned_token_vectors() {
        assert_eq!(encode_token(&[], TokenEncoding::Base32), "");
        assert_eq!(encode_token(&[0], TokenEncoding::Base32), "aa");
        let seq: Vec<u8> = (0..16).collect();
        assert_eq!(
            encode_token(&seq, TokenEncoding::Base32),
            "aaaqeayeaudaocajbifqydiob4"
        );
        assert_eq!(
            encode_token(&[0xff; 16], TokenEncoding::Base32),
            "77777777777777777777777774"
        );
        let seq64: Vec<u8> = (0..64).collect();
        assert_eq!(
            encode_token(&seq64, TokenEncoding::Base32),
            "aaaqeayeaudaocajbifqydiob4ibceqtcqkrmfyydenbwha5dypsaijcemsckjrhfausukzmfuxc6mbrgiztinjwg44dsor3hq6t4py"
        );
    }

    #[test]
    fn base32_is_injective_with_expected_length() {
        let mut seen = std::collections::HashSet::new();
        for n in 0..=u16::MAX {
            let t = encode_token(&n.to_be_bytes(), TokenEncoding::Base32);
            assert_eq!(t.len(), 4, "2 bytes → ⌈16/5⌉ = 4 chars");
            assert!(seen.insert(t), "base32 collision at {n}");
        }
        for (n, want) in [(1usize, 2usize), (8, 13), (16, 26), (32, 52), (64, 103)] {
            assert_eq!(
                encode_token(&vec![0xab; n], TokenEncoding::Base32).len(),
                want
            );
        }
    }

    #[test]
    fn valid_token_shape_matches_encoder_output() {
        for enc in [TokenEncoding::Hex, TokenEncoding::Base32] {
            for n in [1usize, 8, 15, 16, 17, 32, 64] {
                let t = encode_token(&vec![0xa5; n], enc);
                assert_eq!(t.len(), enc.token_char_len(n), "char len, {enc}, {n}B");
                assert!(enc.valid_token_shape(&t, n), "{t} ({enc}, {n}B)");
            }
        }
        let hex = encode_token(&[0xa5; 16], TokenEncoding::Hex);
        let b32 = encode_token(&[0xa5; 16], TokenEncoding::Base32);
        assert!(!TokenEncoding::Hex.valid_token_shape(&hex[..30], 16));
        assert!(!TokenEncoding::Hex.valid_token_shape(&hex.to_uppercase(), 16));
        assert!(!TokenEncoding::Base32.valid_token_shape(&b32, 15));
        assert!(!TokenEncoding::Base32.valid_token_shape("nope!", 16));
    }
}
