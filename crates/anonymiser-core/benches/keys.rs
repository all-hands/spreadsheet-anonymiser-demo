use anonymiser_core::{
    column_key, column_key_scoped, derive_root_key, derive_root_key_raw, Profile,
};
use criterion::{criterion_group, criterion_main, Criterion};
use std::hint::black_box;
use std::time::Duration;

const SALT: [u8; 32] = [9u8; 32];

fn keys(c: &mut Criterion) {
    let mut g = c.benchmark_group("keys");
    let master = b"correct horse battery staple";

    g.sample_size(10).measurement_time(Duration::from_secs(5));
    g.bench_function("argon2id_browser_19MiB_t2", |b| {
        b.iter(|| derive_root_key(black_box(master), &SALT, Profile::browser()).unwrap())
    });
    g.bench_function("argon2id_cli_64MiB_t3", |b| {
        b.iter(|| derive_root_key(black_box(master), &SALT, Profile::cli()).unwrap())
    });

    g.sample_size(100).measurement_time(Duration::from_secs(2));
    g.bench_function("root_key_raw_hkdf", |b| {
        b.iter(|| derive_root_key_raw(black_box(&[1u8; 64]), &SALT))
    });
    let root = derive_root_key_raw(&[1u8; 64], &SALT);
    g.bench_function("column_key_hkdf", |b| {
        b.iter(|| column_key(&root, &SALT, black_box("email")).unwrap())
    });
    g.bench_function("column_key_scoped_hkdf", |b| {
        b.iter(|| column_key_scoped(&root, &SALT, "customers", black_box("email")).unwrap())
    });
    g.finish();
}

criterion_group!(benches, keys);
criterion_main!(benches);
