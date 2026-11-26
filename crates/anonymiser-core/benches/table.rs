use anonymiser_core::{
    apply_typed, column_key, derive_root_key_raw, reencode_token, CanonType, MaskKind, Policy,
    TokenEncoding, DEFAULT_TOKEN_BYTES,
};
use criterion::{criterion_group, criterion_main, Criterion, Throughput};
use std::hint::black_box;
use std::time::Duration;

const ROWS: usize = 10_000;
const SALT: [u8; 32] = [4u8; 32];

const HEADERS: [&str; 10] = [
    "id",
    "first_name",
    "last_name",
    "email",
    "phone",
    "city",
    "dob",
    "iban",
    "notes",
    "status",
];

const FIRST: [&str; 8] = [
    "Hazel", "Robin", "Fern", "Wren", "Iris", "Linnet", "Sorrel", "Finch",
];
const LAST: [&str; 8] = [
    "Dummer",
    "Notreal",
    "Placeholder",
    "Smith",
    "Testwell",
    "Oconnor",
    "Dubois",
    "Rossi",
];
const CITY: [&str; 5] = ["Bristol", "Leeds", "Cardiff", "Glasgow", "York"];
const STATUS: [&str; 3] = ["active", "inactive", "pending"];

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn pick<'a>(&mut self, xs: &[&'a str]) -> &'a str {
        xs[(self.next() as usize) % xs.len()]
    }
}

fn make_table() -> Vec<Vec<String>> {
    let mut r = Lcg(0x5eed);
    (0..ROWS)
        .map(|i| {
            let f = r.pick(&FIRST);
            let l = r.pick(&LAST);
            vec![
                i.to_string(),
                f.to_string(),
                l.to_string(),
                format!("{}.{}{}@example.com", f, l, r.next() % 1000).to_lowercase(),
                format!("+44 20{} {:07}", r.next() % 10, r.next() % 10_000_000),
                r.pick(&CITY).to_string(),
                format!(
                    "{:04}-{:02}-{:02}",
                    1950 + r.next() % 55,
                    1 + r.next() % 12,
                    1 + r.next() % 28
                ),
                format!("GR{:025}", r.next() % 10u64.pow(15)),
                format!(
                    "free text note number {} about {} {}",
                    r.next() % 5000,
                    f,
                    l
                ),
                r.pick(&STATUS).to_string(),
            ]
        })
        .collect()
}

fn run(table: &[Vec<String>], plan: &[(Policy, CanonType)], b32: bool) -> usize {
    let root = derive_root_key_raw(&[1u8; 64], &SALT);
    let keys: Vec<Option<[u8; 64]>> = plan
        .iter()
        .zip(HEADERS)
        .map(|((p, _), name)| match p {
            Policy::Keep => None,
            _ => Some(column_key(&root, &SALT, name).expect("column key")),
        })
        .collect();
    let enc = if b32 {
        TokenEncoding::Base32
    } else {
        TokenEncoding::Hex
    };
    let mut out_bytes = 0;
    for row in table {
        for (c, cell) in row.iter().enumerate() {
            let (policy, ty) = plan[c];
            let v = apply_typed(
                cell,
                policy,
                keys[c].as_ref().map(|k| &k[..]),
                DEFAULT_TOKEN_BYTES,
                ty,
            )
            .expect("apply");
            out_bytes += reencode_token(&v, policy, enc).len();
        }
    }
    out_bytes
}

fn table(c: &mut Criterion) {
    let t = make_table();
    let in_bytes: usize = t.iter().flatten().map(|s| s.len() + 1).sum();

    let mixed = [
        (Policy::Keep, CanonType::Auto),
        (Policy::Hash, CanonType::Text),
        (Policy::Hash, CanonType::Text),
        (Policy::Hash, CanonType::Email),
        (Policy::Mask(MaskKind::Last4), CanonType::Auto),
        (Policy::Keep, CanonType::Auto),
        (Policy::Faux, CanonType::Auto),
        (Policy::Encrypt, CanonType::Auto),
        (Policy::Redact, CanonType::Auto),
        (Policy::Keep, CanonType::Auto),
    ];
    let hash_heavy = [
        (Policy::Keep, CanonType::Auto),
        (Policy::Hash, CanonType::Text),
        (Policy::Hash, CanonType::Text),
        (Policy::Hash, CanonType::Email),
        (Policy::Hash, CanonType::Phone),
        (Policy::Hash, CanonType::Text),
        (Policy::Hash, CanonType::Auto),
        (Policy::Hash, CanonType::Id),
        (Policy::Keep, CanonType::Auto),
        (Policy::Keep, CanonType::Auto),
    ];
    let mut enc_heavy = hash_heavy;
    for p in enc_heavy.iter_mut().filter(|p| p.0 == Policy::Hash) {
        *p = (Policy::Encrypt, CanonType::Auto);
    }

    let mut g = c.benchmark_group("table_10k_x_10");
    g.throughput(Throughput::Bytes(in_bytes as u64));
    g.sample_size(10).measurement_time(Duration::from_secs(5));
    g.bench_function("mixed_hex", |b| {
        b.iter(|| run(black_box(&t), &mixed, false))
    });
    g.bench_function("mixed_base32", |b| {
        b.iter(|| run(black_box(&t), &mixed, true))
    });
    g.bench_function("hash_heavy_hex", |b| {
        b.iter(|| run(black_box(&t), &hash_heavy, false))
    });
    g.bench_function("encrypt_heavy", |b| {
        b.iter(|| run(black_box(&t), &enc_heavy, false))
    });
    g.finish();
}

criterion_group!(benches, table);
criterion_main!(benches);
