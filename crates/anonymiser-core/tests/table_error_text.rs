use anonymiser_core::TableError;

#[test]
fn table_error_text_is_pinned() {
    let cases = [
        (
            TableError::UnknownFormat,
            "unknown table format: expected csv, tsv or jsonl",
        ),
        (
            TableError::UnequalLengths {
                format: "CSV",
                record: 3,
                line: 5,
                expected: 2,
                found: 1,
            },
            "CSV record 3 (line 5): found 1 fields, but the header has 2",
        ),
        (
            TableError::InvalidUtf8 {
                format: "TSV",
                line: 7,
            },
            "TSV line 7: not valid UTF-8",
        ),
        (
            TableError::Json {
                line: 2,
                column: 9,
                reason: "trailing characters".into(),
            },
            "JSONL line 2: invalid JSON: trailing characters (column 9)",
        ),
        (
            TableError::NotAnObject { line: 4 },
            "JSONL line 4: expected a JSON object",
        ),
        (
            TableError::Nested { line: 1 },
            "JSONL line 1: unsupported nested JSON value",
        ),
        (
            TableError::UnknownKey {
                line: 2,
                headers: vec!["a".into(), "b".into()],
                key: "SECRET".into(),
            },
            "JSONL line 2: record has a key not in the header set (a, b) — refusing to silently drop data",
        ),
        (
            TableError::RowLength {
                row: 1,
                expected: 2,
                found: 3,
            },
            "output row 1 has 3 cells, but the header has 2",
        ),
        (
            TableError::Closed,
            "table decoder used after it failed or finished",
        ),
    ];
    for (e, text) in cases {
        assert_eq!(e.to_string(), text);
    }
}
