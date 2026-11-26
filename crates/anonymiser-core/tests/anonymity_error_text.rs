use anonymiser_core::AnonymityError as E;

#[test]
fn texts_are_pinned() {
    let cases = [
        (
            E::KTooSmall,
            "minimum group size must be at least 2 (1 protects nothing)",
        ),
        (E::NoQuasiIdentifiers, "no quasi-identifier columns given"),
        (
            E::ColumnOutOfRange(7, 3),
            "quasi-identifier column 7 is out of range (the table has 3 columns)",
        ),
        (
            E::DuplicateColumn(2),
            "quasi-identifier column 2 is listed more than once",
        ),
        (
            E::RaggedRow {
                row: 4,
                got: 2,
                expected: 3,
            },
            "row 4 has 2 cells, expected 3",
        ),
        (
            E::UnknownMode("x".into()),
            "unknown suppression mode \"x\" (cells|rows)",
        ),
    ];
    for (e, text) in cases {
        assert_eq!(e.to_string(), text);
    }
}
