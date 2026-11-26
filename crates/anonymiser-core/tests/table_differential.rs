use anonymiser_core::{Row, RowSink, TableDecoder, TableEncoder, TableFormat};

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn pick<'a, T>(&mut self, xs: &'a [T]) -> &'a T {
        &xs[self.below(xs.len())]
    }
}

#[derive(Default)]
struct Collect {
    headers: Option<Vec<String>>,
    rows: Vec<Vec<String>>,
}

impl RowSink for Collect {
    fn headers(&mut self, headers: &[String]) {
        self.headers = Some(headers.to_vec());
    }
    fn row(&mut self, row: Row<'_>) {
        self.rows.push(row.iter().map(str::to_owned).collect());
    }
}

type Table = Option<(Vec<String>, Vec<Vec<String>>)>;

fn core_decode(format: TableFormat, input: &[u8], rng: &mut Rng) -> Table {
    let mut d = TableDecoder::new(format);
    let mut s = Collect::default();
    let mut at = 0;
    while at < input.len() {
        let n = match rng.below(4) {
            0 => 1,
            1 => 1 + rng.below(4),
            2 => 1 + rng.below(64),
            _ => input.len() - at,
        }
        .min(input.len() - at);
        d.push(&input[at..at + n], &mut s).ok()?;
        at += n;
    }
    d.finish(&mut s).ok()?;
    Some((s.headers.unwrap_or_default(), s.rows))
}

fn csv_crate_decode(format: TableFormat, input: &[u8]) -> Table {
    let delim = if format == TableFormat::Tsv {
        b'\t'
    } else {
        b','
    };
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .delimiter(delim)
        .from_reader(input);
    let mut headers: Vec<String> = rdr.headers().ok()?.iter().map(str::to_owned).collect();
    if let Some(first) = headers.first_mut() {
        if let Some(rest) = first.strip_prefix('\u{feff}') {
            *first = rest.to_owned();
        }
    }
    let mut rows = Vec::new();
    for r in rdr.records() {
        rows.push(r.ok()?.iter().map(str::to_owned).collect());
    }
    Some((headers, rows))
}

const PIECES: &[&str] = &[
    ",", ",", "\t", "\"", "\"", "\"\"", "\r", "\n", "\r\n", "\n", "a", "b", "xyz", " ", "é", "😀",
    "\u{feff}", "", "0", "\u{0}",
];

fn random_text(rng: &mut Rng) -> Vec<u8> {
    let mut out = Vec::new();
    if rng.below(8) == 0 {
        out.extend_from_slice("\u{feff}".as_bytes());
    }
    for _ in 0..rng.below(40) {
        out.extend_from_slice(rng.pick(PIECES).as_bytes());
    }
    if rng.below(16) == 0 {
        let at = rng.below(out.len() + 1);
        out.insert(at, 0xff);
    }
    out
}

fn random_field(rng: &mut Rng) -> String {
    (0..rng.below(6)).map(|_| *rng.pick(PIECES)).collect()
}

fn random_table(rng: &mut Rng, delim: u8) -> (Vec<String>, Vec<Vec<String>>, Vec<u8>) {
    let cols = 1 + rng.below(4);
    let headers: Vec<String> = (0..cols).map(|_| random_field(rng)).collect();
    let rows: Vec<Vec<String>> = (0..rng.below(6))
        .map(|_| (0..cols).map(|_| random_field(rng)).collect())
        .collect();
    let mut w = csv::WriterBuilder::new()
        .delimiter(delim)
        .from_writer(Vec::new());
    w.write_record(&headers).unwrap();
    for r in &rows {
        w.write_record(r).unwrap();
    }
    let bytes = w.into_inner().unwrap();
    (headers, rows, bytes)
}

fn core_encode(format: TableFormat, headers: &[String], rows: &[Vec<String>]) -> Vec<u8> {
    let mut e = TableEncoder::new(format, headers.to_vec());
    let mut out = Vec::new();
    e.write_header(&mut out);
    for r in rows {
        e.write_row(r.iter().map(String::as_str), &mut out).unwrap();
    }
    out
}

#[test]
fn delimited_decoder_agrees_with_the_csv_crate_on_random_text() {
    let mut rng = Rng(0x00c0_ffee_1234_5678);
    let (mut ok, mut failed) = (0, 0);
    for case in 0..20_000 {
        let format = if case % 3 == 0 {
            TableFormat::Tsv
        } else {
            TableFormat::Csv
        };
        let input = random_text(&mut rng);
        let reference = csv_crate_decode(format, &input);
        let core = core_decode(format, &input, &mut rng);
        assert_eq!(
            core,
            reference,
            "case {case}: {:?}",
            String::from_utf8_lossy(&input)
        );
        if reference.is_some() {
            ok += 1;
        } else {
            failed += 1;
        }
    }
    assert!(ok > 5_000 && failed > 2_000, "ok {ok}, failed {failed}");
}

#[test]
fn delimited_decoder_agrees_with_the_csv_crate_on_random_tables() {
    let mut rng = Rng(0x5eed_0000_0000_0001);
    for case in 0..10_000 {
        let format = if case % 2 == 0 {
            TableFormat::Csv
        } else {
            TableFormat::Tsv
        };
        let delim = if format == TableFormat::Tsv {
            b'\t'
        } else {
            b','
        };
        let (_, _, bytes) = random_table(&mut rng, delim);
        let reference = csv_crate_decode(format, &bytes);
        assert_eq!(
            core_decode(format, &bytes, &mut rng),
            reference,
            "case {case}: {:?}",
            String::from_utf8_lossy(&bytes)
        );
    }
}

#[test]
fn delimited_encoder_agrees_with_the_csv_crate_byte_for_byte() {
    let mut rng = Rng(0x0bad_cafe_0000_0042);
    for case in 0..10_000 {
        let format = if case % 2 == 0 {
            TableFormat::Csv
        } else {
            TableFormat::Tsv
        };
        let delim = if format == TableFormat::Tsv {
            b'\t'
        } else {
            b','
        };
        let (headers, rows, reference) = random_table(&mut rng, delim);
        assert_eq!(
            core_encode(format, &headers, &rows),
            reference,
            "case {case}: {headers:?} {rows:?}"
        );
    }
}

fn json_cell(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Null => Some(String::new()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn cli_jsonl_decode(input: &[u8]) -> Table {
    let text = std::str::from_utf8(input).ok()?;
    let mut lines = text.split_inclusive('\n');
    let first = loop {
        let l = lines.next()?;
        if !l.trim().is_empty() {
            break l;
        }
    };
    let obj: serde_json::Map<String, serde_json::Value> = serde_json::from_str(first).ok()?;
    let headers: Vec<String> = obj.keys().cloned().collect();
    let mut rows = vec![headers
        .iter()
        .map(|h| json_cell(&obj[h]))
        .collect::<Option<Vec<_>>>()?];
    for l in lines {
        if l.trim().is_empty() {
            continue;
        }
        let obj: serde_json::Map<String, serde_json::Value> = serde_json::from_str(l).ok()?;
        if obj.keys().any(|k| !headers.contains(k)) {
            return None;
        }
        rows.push(
            headers
                .iter()
                .map(|h| obj.get(h).map_or(Some(String::new()), json_cell))
                .collect::<Option<Vec<_>>>()?,
        );
    }
    Some((headers, rows))
}

const KEYS: &[&str] = &["a", "b", "é", "A", "_", "😀", "a\"b", "\\u0041"];
const VALUES: &[&str] = &[
    "\"x\"",
    "\"\"",
    "\"\\n\\t\\\"\"",
    "\"\\ud83d\\ude00\"",
    "null",
    "true",
    "false",
    "0",
    "-0",
    "1.5",
    "1e3",
    "-1E-7",
    "12345678901234567.0",
    "18446744073709551616",
    "-9223372036854775809",
    "123456789.123456789",
    "\"é\"",
];
const BAD_VALUES: &[&str] = &["\"\\ud800\"", "1e400", "01", "[1]", "{}", "{\"k\":1}"];
const NOISE: &[&str] = &["", " ", "\t", "\r", "\u{feff}", ",", "}", "x"];

fn random_jsonl(rng: &mut Rng) -> Vec<u8> {
    let mut out = String::new();
    let keyset: Vec<&str> = (0..1 + rng.below(3)).map(|_| *rng.pick(KEYS)).collect();
    for _ in 0..rng.below(6) {
        match rng.below(20) {
            0 | 1 => out.push_str(rng.pick::<&str>(&["", "  ", "\t\r", "\u{a0}", "\u{85}"])),
            2 => out.push_str(rng.pick::<&str>(&["[1]", "\"s\"", "null", "{\"a\":1}{}"])),
            _ => {
                out.push('{');
                for i in 0..rng.below(4) {
                    if i > 0 {
                        out.push(',');
                    }
                    let key = if rng.below(15) == 0 {
                        *rng.pick(KEYS)
                    } else {
                        *rng.pick(&keyset)
                    };
                    let value = if rng.below(25) == 0 {
                        rng.pick(BAD_VALUES)
                    } else {
                        rng.pick(VALUES)
                    };
                    out.push_str(&format!("\"{key}\":{value}"));
                }
                out.push('}');
                if rng.below(12) == 0 {
                    out.push_str(rng.pick::<&str>(NOISE));
                }
            }
        }
        out.push_str(rng.pick::<&str>(&["\n", "\n", "\r\n", ""]));
    }
    let mut bytes = out.into_bytes();
    if rng.below(20) == 0 {
        let at = rng.below(bytes.len() + 1);
        bytes.insert(at, 0xff);
    }
    bytes
}

#[test]
fn jsonl_decoder_agrees_with_the_cli_reader_on_random_lines() {
    let mut rng = Rng(0x7a51_e000_dead_beef);
    let (mut ok, mut failed) = (0, 0);
    for case in 0..20_000 {
        let input = random_jsonl(&mut rng);
        let reference = cli_jsonl_decode(&input);
        let core = core_decode(TableFormat::Jsonl, &input, &mut rng);
        let text = String::from_utf8_lossy(&input);
        let feff_blank_line = text.split('\n').any(|l| {
            l.contains('\u{feff}')
                && l.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
                    .is_empty()
        });
        if feff_blank_line || (reference.is_none() && core == Some((vec![], vec![]))) {
            continue;
        }
        assert_eq!(core, reference, "case {case}: {text:?}");
        if reference.is_some() {
            ok += 1;
        } else {
            failed += 1;
        }
    }
    assert!(ok > 3_000 && failed > 3_000, "ok {ok}, failed {failed}");
}

#[test]
fn jsonl_encoder_agrees_with_the_cli_writer() {
    let mut rng = Rng(0x1111_2222_3333_4444);
    for case in 0..5_000 {
        let mut headers: Vec<String> = (0..1 + rng.below(4))
            .map(|_| random_field(&mut rng))
            .collect();
        headers.sort();
        headers.dedup();
        let rows: Vec<Vec<String>> = (0..rng.below(4))
            .map(|_| headers.iter().map(|_| random_field(&mut rng)).collect())
            .collect();
        let mut reference = Vec::new();
        for r in &rows {
            let mut obj = serde_json::Map::new();
            for (h, v) in headers.iter().zip(r) {
                obj.insert(h.clone(), serde_json::Value::String(v.clone()));
            }
            serde_json::to_writer(&mut reference, &obj).unwrap();
            reference.push(b'\n');
        }
        assert_eq!(
            core_encode(TableFormat::Jsonl, &headers, &rows),
            reference,
            "case {case}"
        );
    }
}
