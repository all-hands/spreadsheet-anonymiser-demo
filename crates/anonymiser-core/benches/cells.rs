use anonymiser_core::{
    apply, canonicalize, canonicalize_typed, encode_token, encrypt_cell, faux, hash_cell,
    kyber_encrypt_cell, mask, reencode_token, CanonType, MaskKind, Policy, TokenEncoding,
    DEFAULT_TOKEN_BYTES,
};
use criterion::{criterion_group, criterion_main, Criterion};
use std::hint::black_box;
use std::time::Duration;

const NAME: &str = "  Hazel   Dummer-Smith ";
const EMAIL: &str = "Hazel.Dummer@Example.COM";
const PHONE: &str = "+44 (161) 555-1234";
const KEY: [u8; 64] = [7u8; 64];

fn canon(c: &mut Criterion) {
    let mut g = c.benchmark_group("canonicalize");
    g.bench_function("text", |b| b.iter(|| canonicalize(black_box(NAME))));
    g.bench_function("email", |b| b.iter(|| canonicalize(black_box(EMAIL))));
    g.bench_function("phone", |b| b.iter(|| canonicalize(black_box(PHONE))));
    g.bench_function("email_typed", |b| {
        b.iter(|| canonicalize_typed(black_box(EMAIL), CanonType::Email))
    });
    g.finish();
}

fn hashing(c: &mut Criterion) {
    let mut g = c.benchmark_group("hash");
    g.bench_function("hash_cell_hex16", |b| {
        b.iter(|| {
            hash_cell(
                black_box("alexandra papadopoulou"),
                &KEY,
                DEFAULT_TOKEN_BYTES,
            )
        })
    });
    g.bench_function("policy_hash_hex", |b| {
        b.iter(|| {
            apply(
                black_box(EMAIL),
                Policy::Hash,
                Some(&KEY),
                DEFAULT_TOKEN_BYTES,
            )
        })
    });
    g.bench_function("policy_hash_base32", |b| {
        b.iter(|| {
            let t = apply(
                black_box(EMAIL),
                Policy::Hash,
                Some(&KEY),
                DEFAULT_TOKEN_BYTES,
            )
            .expect("keyed hash");
            reencode_token(&t, Policy::Hash, TokenEncoding::Base32)
        })
    });
    let mac = [0xa5u8; 16];
    g.bench_function("encode_hex16", |b| {
        b.iter(|| encode_token(black_box(&mac), TokenEncoding::Hex))
    });
    g.bench_function("encode_base32_16", |b| {
        b.iter(|| encode_token(black_box(&mac), TokenEncoding::Base32))
    });
    for tb in [8usize, 16, 32, 64] {
        g.bench_function(format!("hash_cell_truncate_{tb}B"), |b| {
            b.iter(|| hash_cell(black_box("alexandra papadopoulou"), &KEY, tb))
        });
    }
    g.finish();
}

fn masking(c: &mut Criterion) {
    let mut g = c.benchmark_group("mask_faux");
    g.bench_function("mask_email", |b| {
        b.iter(|| mask(black_box(EMAIL), MaskKind::Email))
    });
    g.bench_function("mask_last4_phone", |b| {
        b.iter(|| mask(black_box(PHONE), MaskKind::Last4))
    });
    g.bench_function("mask_auto_name", |b| {
        b.iter(|| mask(black_box(NAME), MaskKind::Auto))
    });
    g.bench_function("faux_email", |b| b.iter(|| faux(black_box(EMAIL))));
    g.bench_function("faux_text", |b| b.iter(|| faux(black_box(NAME))));
    g.bench_function("redact", |b| {
        b.iter(|| apply(black_box(NAME), Policy::Redact, None, DEFAULT_TOKEN_BYTES))
    });
    g.bench_function("keep", |b| {
        b.iter(|| apply(black_box(NAME), Policy::Keep, None, DEFAULT_TOKEN_BYTES))
    });
    g.finish();
}

fn encryption(c: &mut Criterion) {
    let mut g = c.benchmark_group("encrypt");
    let nonce = [3u8; 12];
    g.bench_function("aes_gcm_encrypt_cell", |b| {
        b.iter(|| encrypt_cell(black_box(EMAIL), &KEY, &nonce))
    });
    g.bench_function("policy_encrypt", |b| {
        b.iter(|| {
            apply(
                black_box(EMAIL),
                Policy::Encrypt,
                Some(&KEY),
                DEFAULT_TOKEN_BYTES,
            )
        })
    });
    g.bench_function("kyber_aes_encrypt_cell", |b| {
        b.iter(|| kyber_encrypt_cell(black_box(EMAIL), &KEY))
    });
    g.finish();
}

fn config() -> Criterion {
    Criterion::default()
        .warm_up_time(Duration::from_millis(500))
        .measurement_time(Duration::from_secs(2))
        .sample_size(50)
}

criterion_group! {
    name = benches;
    config = config();
    targets = canon, hashing, masking, encryption
}
criterion_main!(benches);
