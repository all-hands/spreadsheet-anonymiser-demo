use super::*;

#[derive(Default, Debug, PartialEq)]
struct Collect {
    headers: Option<Vec<String>>,
    announced: usize,
    rows: Vec<Vec<String>>,
}

impl RowSink for Collect {
    fn headers(&mut self, headers: &[String]) {
        assert!(self.rows.is_empty(), "headers before rows");
        self.announced += 1;
        self.headers = Some(headers.to_vec());
    }
    fn row(&mut self, row: Row<'_>) {
        self.rows.push(row.iter().map(str::to_owned).collect());
    }
}

type Decoded = Result<(Option<Vec<String>>, Vec<Vec<String>>), TableError>;

fn decode_cut(format: TableFormat, input: &[u8], cuts: &[usize]) -> Decoded {
    let mut d = TableDecoder::new(format);
    let mut sink = Collect::default();
    let mut at = 0;
    for &cut in cuts.iter().chain(std::iter::once(&input.len())) {
        d.push(&input[at..cut], &mut sink)?;
        at = cut;
    }
    d.finish(&mut sink)?;
    assert!(sink.announced <= 1, "headers announced once");
    assert_eq!(d.headers().map(<[String]>::to_vec), sink.headers);
    Ok((sink.headers, sink.rows))
}

fn decode(format: TableFormat, input: &str) -> Decoded {
    decode_cut(format, input.as_bytes(), &[])
}

fn csv(input: &str) -> Decoded {
    decode(TableFormat::Csv, input)
}

fn jsonl(input: &str) -> Decoded {
    decode(TableFormat::Jsonl, input)
}

fn table(headers: &[&str], rows: &[&[&str]]) -> Decoded {
    Ok((
        Some(headers.iter().map(|s| s.to_string()).collect()),
        rows.iter()
            .map(|r| r.iter().map(|s| s.to_string()).collect())
            .collect(),
    ))
}

fn err(d: Decoded) -> String {
    d.expect_err("must fail").to_string()
}

fn assert_slicing_invariant(format: TableFormat, input: &[u8]) {
    let whole = decode_cut(format, input, &[]);
    for i in 0..=input.len() {
        assert_eq!(decode_cut(format, input, &[i]), whole, "cut at {i}");
        for j in i..=input.len() {
            assert_eq!(decode_cut(format, input, &[i, j]), whole, "cuts {i},{j}");
        }
    }
    let all: Vec<usize> = (1..input.len()).collect();
    assert_eq!(decode_cut(format, input, &all), whole, "byte by byte");
}

fn encode(format: TableFormat, headers: &[&str], rows: &[&[&str]]) -> String {
    let mut e = TableEncoder::new(format, headers.iter().map(|s| s.to_string()).collect());
    let mut out = Vec::new();
    e.write_header(&mut out);
    for r in rows {
        e.write_row(r.iter().copied(), &mut out).unwrap();
    }
    String::from_utf8(out).unwrap()
}

#[test]
fn quotes_embedded_delimiters_newlines_and_doubled_quotes() {
    assert_eq!(
        csv("w,x,y,z\na,\"b,c\",\"d\ne\",\"say \"\"hi\"\"\"\n"),
        table(
            &["w", "x", "y", "z"],
            &[&["a", "b,c", "d\ne", "say \"hi\""]]
        )
    );
}

#[test]
fn lf_cr_and_crlf_terminate_records_and_blank_lines_are_skipped() {
    assert_eq!(
        csv("a,b\r\nc,d\re,f\n\n\ng,h"),
        table(&["a", "b"], &[&["c", "d"], &["e", "f"], &["g", "h"]])
    );
}

#[test]
fn a_lone_quoted_empty_field_is_a_record_but_a_blank_line_is_not() {
    assert_eq!(csv("h\n\"\"\n\nx\n"), table(&["h"], &[&[""], &["x"]]));
}

#[test]
fn trailing_empty_fields_and_a_literal_quote_inside_an_unquoted_field() {
    assert_eq!(
        csv("x,y,z\na,,\nb\"c,d,\n"),
        table(&["x", "y", "z"], &[&["a", "", ""], &["b\"c", "d", ""]])
    );
}

#[test]
fn tsv_uses_the_tab_delimiter() {
    assert_eq!(
        decode(TableFormat::Tsv, "x\ty\tz\na\t\"b\tc\"\td\n"),
        table(&["x", "y", "z"], &[&["a", "b\tc", "d"]])
    );
}

#[test]
fn delimited_every_slicing_gives_the_same_records() {
    let text = "h1,h2,h3\r\n\"a,\"\"x\"\"\r\nb\",c,\r\n\r\n,\"\",\n\"ué\",,\r\nx,y,\"unterminated";
    let whole = csv(text).unwrap();
    assert_eq!(whole.1.len(), 4);
    assert_slicing_invariant(TableFormat::Csv, text.as_bytes());
}

#[test]
fn encoder_quotes_only_when_needed_and_ends_with_lf() {
    let cells: &[&str] = &["a", "b,c", "d\"e", "f\ng", "h\ri", " j "];
    let h: Vec<&str> = (0..cells.len()).map(|_| "h").collect();
    let out = encode(TableFormat::Csv, &h, &[cells]);
    assert_eq!(
        out.split_once('\n').unwrap().1,
        "a,\"b,c\",\"d\"\"e\",\"f\ng\",\"h\ri\", j \n"
    );
}

#[test]
fn encoder_quotes_a_record_that_is_a_single_empty_field() {
    assert_eq!(encode(TableFormat::Csv, &["h"], &[&[""]]), "h\n\"\"\n");
    assert_eq!(
        encode(TableFormat::Csv, &["a", "b"], &[&["", ""]]),
        "a,b\n,\n"
    );
}

#[test]
fn encoder_tsv_uses_the_tab_and_does_not_quote_commas() {
    assert_eq!(
        encode(TableFormat::Tsv, &["a", "b"], &[&["a,b", "c\td"]]),
        "a\tb\na,b\t\"c\td\"\n"
    );
}

#[test]
fn a_bom_is_stripped_from_the_first_header_and_headers_are_not_rows() {
    assert_eq!(
        csv("\u{feff}id,name\n1,Ann\n"),
        table(&["id", "name"], &[&["1", "Ann"]])
    );
}

#[test]
fn headers_are_announced_exactly_once_across_pushes() {
    let mut d = TableDecoder::new(TableFormat::Csv);
    let mut s = Collect::default();
    d.push(b"id,na", &mut s).unwrap();
    assert_eq!(s.headers, None);
    d.push(b"me\n1,Ann\n2,Bo\n", &mut s).unwrap();
    assert_eq!(s.headers, Some(vec!["id".into(), "name".into()]));
    d.finish(&mut s).unwrap();
    assert_eq!(s.announced, 1);
    assert_eq!(s.rows, vec![vec!["1", "Ann"], vec!["2", "Bo"]]);
}

#[test]
fn ragged_records_fail_closed_without_echoing_data() {
    let e = err(csv("a,b\nSECRET,2,3\n"));
    assert_eq!(
        e,
        "CSV record 1 (line 2): found 3 fields, but the header has 2"
    );
    let e = err(decode(TableFormat::Tsv, "a\tb\nok\tok\nSECRET\n"));
    assert_eq!(
        e,
        "TSV record 2 (line 3): found 1 fields, but the header has 2"
    );
    assert!(err(csv("a,b\n\"\"\n")).contains("found 1 fields"));
    assert_eq!(
        err(csv("a,b\n1,2\n3")),
        "CSV record 2 (line 3): found 1 fields, but the header has 2"
    );
}

#[test]
fn invalid_utf8_fails_closed() {
    let e = decode_cut(TableFormat::Csv, b"a,b\n\xff,2\n", &[]).unwrap_err();
    assert_eq!(e.to_string(), "CSV line 2: not valid UTF-8");
    let e = decode_cut(TableFormat::Csv, b"a\xff,b\n1,2\n", &[]).unwrap_err();
    assert_eq!(e.to_string(), "CSV line 1: not valid UTF-8");
    let ok = "a,é\n😀,2\n".as_bytes();
    assert_slicing_invariant(TableFormat::Csv, ok);
}

#[test]
fn quotes_are_literal_except_at_field_start() {
    assert_eq!(
        csv("a,b,c\nx\"y,\"x\"y,\"x\"\"y\"z\n"),
        table(&["a", "b", "c"], &[&["x\"y", "xy", "x\"yz"]])
    );
}

#[test]
fn an_unterminated_quoted_field_ends_at_end_of_input() {
    assert_eq!(csv("a,b\n1,\"abc"), table(&["a", "b"], &[&["1", "abc"]]));
    assert_eq!(
        csv("a,b\n1,\"abc\n"),
        table(&["a", "b"], &[&["1", "abc\n"]])
    );
}

#[test]
fn lone_cr_cr_cr_and_crlf_all_end_records() {
    assert_eq!(csv("a,b\r1,2\r"), table(&["a", "b"], &[&["1", "2"]]));
    assert_eq!(csv("a,b\r\r1,2\n"), table(&["a", "b"], &[&["1", "2"]]));
    assert_eq!(csv("a,b\r\n1,2\r\n"), table(&["a", "b"], &[&["1", "2"]]));
    assert_eq!(
        csv("a,b\n\"x\ry\",2\n"),
        table(&["a", "b"], &[&["x\ry", "2"]])
    );
}

#[test]
fn leading_and_trailing_blank_lines_are_skipped() {
    assert_eq!(
        csv("\n\na,b\n\n1,2\n\n\r\n"),
        table(&["a", "b"], &[&["1", "2"]])
    );
}

#[test]
fn bom_handling_matches_the_cli() {
    assert_eq!(
        csv("\u{feff}\"a,x\",b\n1,2\n"),
        table(&["a,x", "b"], &[&["1", "2"]])
    );
    assert_eq!(
        csv("\u{feff}\u{feff}\u{feff}a,b\n1,2\n"),
        table(&["\u{feff}a", "b"], &[&["1", "2"]])
    );
    assert_eq!(
        csv("a,b\n\u{feff}x,\u{feff}\n"),
        table(&["a", "b"], &[&["\u{feff}x", "\u{feff}"]])
    );
    assert_slicing_invariant(TableFormat::Csv, "\u{feff}\"a,x\",b\n1,2\n".as_bytes());
    assert_eq!(csv("\u{feff}"), Ok((None, vec![])));
    assert_eq!(csv(""), Ok((None, vec![])));
    assert_eq!(csv("\n\r\n"), Ok((None, vec![])));
}

#[test]
fn header_only_tables_and_odd_headers() {
    assert_eq!(csv("a,b\n"), table(&["a", "b"], &[]));
    assert_eq!(csv("a,b"), table(&["a", "b"], &[]));
    assert_eq!(csv("a,a\n1,2\n"), table(&["a", "a"], &[&["1", "2"]]));
    assert_eq!(csv(",b\n1,2\n"), table(&["", "b"], &[&["1", "2"]]));
    assert_eq!(
        csv(" a , b \n 1 , 2 \n"),
        table(&[" a ", " b "], &[&[" 1 ", " 2 "]])
    );
    assert_eq!(
        csv("a,b,\n1,2,\n"),
        table(&["a", "b", ""], &[&["1", "2", ""]])
    );
}

#[test]
fn nul_and_very_long_fields_are_data() {
    assert_eq!(
        csv("a,b\n1\u{0}2,3\n"),
        table(&["a", "b"], &[&["1\u{0}2", "3"]])
    );
    let long = "x".repeat(1 << 20);
    let quoted = "y\n,\"".repeat(100_000);
    let text = format!("a,b\n{long},\"{}\"\n", quoted.replace('"', "\"\""));
    let (_, rows) = csv(&text).unwrap();
    assert_eq!(rows, vec![vec![long, quoted]]);
}

#[test]
fn memory_is_bounded_by_the_current_record() {
    let mut d = TableDecoder::new(TableFormat::Csv);
    struct Count(usize);
    impl RowSink for Count {
        fn headers(&mut self, _: &[String]) {}
        fn row(&mut self, _: Row<'_>) {
            self.0 += 1;
        }
    }
    let mut n = Count(0);
    let chunk = "abc,\"d,e\"\n".repeat(400);
    d.push(b"h1,h2\n", &mut n).unwrap();
    for _ in 0..2500 {
        d.push(chunk.as_bytes(), &mut n).unwrap();
    }
    d.finish(&mut n).unwrap();
    assert_eq!(n.0, 1_000_000);
    let Inner::Delimited(inner) = &d.inner else {
        unreachable!()
    };
    assert!(
        inner.buffer_bytes() <= 4096 + 64 * 8,
        "buffers did not grow"
    );
}

#[test]
fn a_failed_decoder_stays_closed() {
    let mut d = TableDecoder::new(TableFormat::Csv);
    let mut s = Collect::default();
    assert!(d.push(b"a,b\n1\n2,3\n", &mut s).is_err());
    assert_eq!(d.push(b"4,5\n", &mut s), Err(TableError::Closed));
    assert_eq!(d.finish(&mut s), Err(TableError::Closed));
}

#[test]
fn encoder_rejects_rows_of_the_wrong_length() {
    let mut e = TableEncoder::new(TableFormat::Csv, vec!["a".into(), "b".into()]);
    let mut out = Vec::new();
    let r = e.write_row(["only"], &mut out);
    assert_eq!(
        r.unwrap_err().to_string(),
        "output row 1 has 1 cells, but the header has 2"
    );
    let mut e = TableEncoder::new(TableFormat::Jsonl, vec!["a".into()]);
    assert!(e.write_row(["x", "y"], &mut out).is_err());
}

#[test]
fn encoder_writes_an_empty_header_as_a_bare_terminator() {
    assert_eq!(encode(TableFormat::Csv, &[], &[]), "\n");
}

const NUMBERS: &[(&str, &str)] = &[
    ("1e15", "1000000000000000.0"),
    ("1e16", "1e+16"),
    ("1e17", "1e+17"),
    ("123456789012345680000", "1.2345678901234567e+20"),
    ("1e-4", "0.0001"),
    ("1e-5", "0.00001"),
    ("1e-6", "1e-6"),
    ("1e-7", "1e-7"),
    ("0.000123", "0.000123"),
    ("1.2345e-5", "0.000012345"),
    ("12345678.9", "12345678.9"),
    ("1.7976931348623157e308", "1.7976931348623157e+308"),
    ("5e-324", "5e-324"),
    ("4.35", "4.35"),
    ("1234567890123456.7", "1234567890123456.8"),
    ("12345678901234567.0", "1.2345678901234566e+16"),
    ("1e300", "1e+300"),
    ("0.5", "0.5"),
    ("100.0", "100.0"),
    ("1.0E+2", "100.0"),
    ("2.5e-5", "0.000025"),
    ("9007199254740993", "9007199254740993"),
    ("18446744073709551615", "18446744073709551615"),
    ("18446744073709551616", "1.8446744073709552e+19"),
    ("-9223372036854775808", "-9223372036854775808"),
    ("-1.5", "-1.5"),
    ("-1e-7", "-1e-7"),
    ("123456789.123456789", "123456789.12345679"),
    ("1e22", "1e+22"),
    ("1e23", "1e+23"),
    ("8.5e15", "8500000000000000.0"),
    ("8.5e16", "8.5e+16"),
    ("0.001", "0.001"),
    ("0.0001234", "0.0001234"),
    ("3e-5", "0.00003"),
    ("0.0", "0.0"),
    ("-0.0", "-0.0"),
    ("0", "0"),
    ("-0", "-0.0"),
    ("10.50", "10.5"),
    ("1e3", "1000.0"),
    ("-9223372036854775809", "-9.223372036854776e+18"),
    ("1e-400", "0.0"),
];

#[test]
fn numbers_print_as_the_cli_printed_them() {
    for (lexeme, printed) in NUMBERS {
        let (_, rows) = jsonl(&format!("{{\"a\":{lexeme}}}")).unwrap();
        assert_eq!(rows, vec![vec![printed.to_string()]], "{lexeme}");
    }
}

#[test]
fn numbers_out_of_f64_range_fail() {
    let e = err(jsonl("{\"a\":1E400}"));
    assert_eq!(
        e,
        "JSONL line 1: invalid JSON: number out of range (column 10)"
    );
    assert!(err(jsonl("{\"a\":1e1000000}")).contains("out of range"));
}

#[test]
fn columns_are_the_sorted_keys_and_missing_keys_read_as_empty() {
    assert_eq!(
        jsonl("{\"b\":1,\"a\":\"x\"}\n{\"b\":2}\n"),
        table(&["a", "b"], &[&["x", "1"], &["", "2"]])
    );
    let (h, _) =
        jsonl("{\"b\":1,\"a\":2,\"C\":3,\"é\":4,\"Z\":5,\"😀\":6,\"\u{ffff}\":7,\"_\":8,\"1\":9}")
            .unwrap();
    assert_eq!(
        h.unwrap(),
        ["1", "C", "Z", "_", "a", "b", "é", "\u{ffff}", "😀"]
    );
}

#[test]
fn scalars_stringify_like_the_cli_and_blank_lines_are_skipped() {
    assert_eq!(
        jsonl("{\"n\":null,\"t\":true,\"f\":false,\"s\":\"\\u00e9\\n\",\"x\":1.0}\n\n  \n")
            .unwrap()
            .1,
        vec![vec!["false", "", "é\n", "true", "1.0"]]
    );
}

#[test]
fn nested_unknown_and_invalid_lines_fail_without_echoing_data() {
    assert_eq!(
        err(jsonl("{\"a\":[1]}")),
        "JSONL line 1: unsupported nested JSON value"
    );
    assert_eq!(
        err(jsonl("{\"a\":{\"b\":1}}")),
        "JSONL line 1: unsupported nested JSON value"
    );
    assert_eq!(
        err(jsonl("{\"a\":1}\n{\"a\":[2]}")),
        "JSONL line 2: unsupported nested JSON value"
    );
    let unknown = jsonl("{\"a\":1}\n{\"a\":1,\"SECRET\":2}").unwrap_err();
    assert_eq!(
        unknown.to_string(),
        "JSONL line 2: record has a key not in the header set (a) — refusing to silently drop data"
    );
    assert!(matches!(unknown, TableError::UnknownKey { ref key, .. } if key == "SECRET"));
    for bad in [
        "{\"a\":1}\nnot json SECRET",
        "{\"a\":1}\n\"SECRET\"",
        "{\"a\":1}\n12345",
        "{\"a\":1}\n[\"SECRET\"]",
        "{\"a\":1}\n{\"a\":\"SECRET\"} SECRET",
        "{\"a\":1}\n{\"a\":SECRET}",
    ] {
        let e = err(jsonl(bad));
        assert!(e.starts_with("JSONL line 2: "), "{e}");
        assert!(!e.contains("SECRET") && !e.contains("12345"), "{e}");
    }
}

#[test]
fn a_line_split_across_pushes_and_crlf_endings() {
    let mut d = TableDecoder::new(TableFormat::Jsonl);
    let mut s = Collect::default();
    d.push(b"{\"a\":\"x\"", &mut s).unwrap();
    assert!(s.rows.is_empty());
    d.push(b"}\r\n{\"a\":\"y\"}", &mut s).unwrap();
    d.finish(&mut s).unwrap();
    assert_eq!(s.rows, vec![vec!["x"], vec!["y"]]);
}

#[test]
fn a_blank_only_input_has_no_header_set() {
    assert_eq!(jsonl("  "), Ok((None, vec![])));
    assert_eq!(jsonl(""), Ok((None, vec![])));
    assert_eq!(jsonl("\n \n\t\r\n"), Ok((None, vec![])));
}

#[test]
fn jsonl_encoder_keeps_header_order_and_writes_strings() {
    assert_eq!(
        encode(TableFormat::Jsonl, &["a", "b"], &[&["x\"\\\n", ""]]),
        "{\"a\":\"x\\\"\\\\\\n\",\"b\":\"\"}\n"
    );
    assert_eq!(
        encode(
            TableFormat::Jsonl,
            &["k"],
            &[&["\u{1}\u{8}\u{c}\t\r/\u{7f}\u{2028}é😀"]]
        ),
        "{\"k\":\"\\u0001\\b\\f\\t\\r/\u{7f}\u{2028}é😀\"}\n"
    );
    assert_eq!(encode(TableFormat::Jsonl, &[], &[&[]]), "{}\n");
}

#[test]
fn duplicate_keys_later_wins() {
    assert_eq!(jsonl("{\"a\":1,\"a\":2}\n"), table(&["a"], &[&["2"]]));
}

#[test]
fn booleans_null_and_number_vs_string() {
    assert_eq!(
        jsonl("{\"a\":1.5}\n{\"a\":\"1.5\"}\n{\"a\":true}\n{\"a\":null}\n"),
        table(&["a"], &[&["1.5"], &["1.5"], &["true"], &[""]])
    );
}

#[test]
fn whitespace_lines_and_trailing_whitespace() {
    assert_eq!(
        jsonl("\n  \n{\"a\":1}\n\n\t\r\n{\"a\":2}\n  \n"),
        table(&["a"], &[&["1"], &["2"]])
    );
    assert_eq!(
        jsonl("{\"a\":1}   \t\r\n{\"a\":2}  "),
        table(&["a"], &[&["1"], &["2"]])
    );
    assert_eq!(
        jsonl("   { \"a\" : 1 , \"b\" : \"x\" }\n"),
        table(&["a", "b"], &[&["1", "x"]])
    );
    for blank in [
        "\u{a0}",
        "\u{85}",
        "\u{2028}",
        "\u{3000}",
        "\u{feff}",
        " \u{feff}\u{a0} ",
    ] {
        let text = format!("{{\"a\":1}}\n{blank}\n{{\"a\":2}}\n");
        assert_eq!(jsonl(&text), table(&["a"], &[&["1"], &["2"]]), "{blank:?}");
    }
}

#[test]
fn non_object_lines_fail() {
    for line in ["[1]", "\"x\"", "123", "null", "true"] {
        assert_eq!(
            err(jsonl(line)),
            "JSONL line 1: expected a JSON object",
            "{line}"
        );
    }
}

#[test]
fn syntax_errors_fail_with_serde_json_reasons() {
    let cases = [
        ("{\"a\":01}", "invalid number"),
        ("{\"a\":+1}", "expected value"),
        ("{\"a\":.5}", "expected value"),
        ("{\"a\":1.}", "invalid number"),
        ("{\"a\":NaN}", "expected value"),
        ("{\"a\":1,}", "trailing comma"),
        ("{\"a\":1} x", "trailing characters"),
        ("{\"a\":1}{\"a\":2}", "trailing characters"),
        ("{\"a\":1}\r{\"a\":2}", "trailing characters"),
        (
            "{\"a\":\"x\ty\"}",
            "control character (\\u0000-\\u001F) found while parsing a string",
        ),
        ("{\"a\":\"\\ud800\"}", "unexpected end of hex escape"),
        ("{\"a\":1", "EOF while parsing an object"),
        ("\u{feff}{\"a\":1}", "expected value"),
    ];
    for (line, reason) in cases {
        let e = err(jsonl(line));
        assert!(
            e.starts_with(&format!("JSONL line 1: invalid JSON: {reason} (column ")),
            "{line:?}: {e}"
        );
    }
    let deep = format!("{{\"a\":{}{}}}", "[".repeat(200), "]".repeat(200));
    assert!(err(jsonl(&deep)).contains("recursion limit exceeded"));
}

#[test]
fn invalid_utf8_in_jsonl_fails() {
    let e = decode_cut(TableFormat::Jsonl, b"{\"a\":1}\n{\"a\":\"\xff\"}\n", &[]).unwrap_err();
    assert_eq!(e.to_string(), "JSONL line 2: not valid UTF-8");
}

#[test]
fn empty_objects_give_an_empty_header_set() {
    assert_eq!(jsonl("{}\n{}\n"), Ok((Some(vec![]), vec![vec![], vec![]])));
    assert!(err(jsonl("{}\n{\"a\":1}")).contains("not in the header set ()"));
}

#[test]
fn jsonl_every_slicing_gives_the_same_rows() {
    let text = "\u{feff}\n{\"b\":\"é\\n\",\"a\":1e3}\r\n\n  {\"a\":null}\n{\"b\":\"😀\"}";
    let (_, rows) = jsonl(text).unwrap();
    assert_eq!(rows.len(), 3);
    assert_slicing_invariant(TableFormat::Jsonl, text.as_bytes());
}

#[test]
fn jsonl_memory_is_bounded_by_the_current_line() {
    let mut d = TableDecoder::new(TableFormat::Jsonl);
    let mut s = Collect::default();
    d.push(b"{\"a\":\"", &mut s).unwrap();
    for _ in 0..100 {
        d.push(&[b'z'; 1000], &mut s).unwrap();
    }
    d.push(b"\"}\n{\"a\":", &mut s).unwrap();
    let Inner::Jsonl(inner) = &d.inner else {
        unreachable!()
    };
    assert_eq!(inner.carry_len(), 5, "only the partial line is kept");
    d.push(b"1}\n", &mut s).unwrap();
    d.finish(&mut s).unwrap();
    assert_eq!(s.rows.len(), 2);
}

#[test]
fn format_names_round_trip() {
    for f in [TableFormat::Csv, TableFormat::Tsv, TableFormat::Jsonl] {
        assert_eq!(f.name().parse::<TableFormat>(), Ok(f));
    }
    assert_eq!(
        "xlsx".parse::<TableFormat>(),
        Err(TableError::UnknownFormat)
    );
}

#[test]
fn rows_expose_their_packed_form() {
    struct Packed(Vec<(String, Vec<usize>)>);
    impl RowSink for Packed {
        fn headers(&mut self, _: &[String]) {}
        fn row(&mut self, row: Row<'_>) {
            self.0.push((row.concat().to_owned(), row.ends().to_vec()));
        }
    }
    for format in [TableFormat::Csv, TableFormat::Jsonl] {
        let input = match format {
            TableFormat::Jsonl => "{\"a\":\"x\\\"y\",\"b\":\"\",\"c\":\"é\"}\n",
            _ => "a,b,c\n\"x\"\"y\",,é\n",
        };
        let mut d = TableDecoder::new(format);
        let mut p = Packed(Vec::new());
        d.push(input.as_bytes(), &mut p).unwrap();
        d.finish(&mut p).unwrap();
        assert_eq!(
            p.0,
            vec![("x\"yé".to_string(), vec![3, 3, 5])],
            "{format:?}"
        );
    }
}
