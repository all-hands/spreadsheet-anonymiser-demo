"""Builds the .xlsx fixtures next to this file.

The workbooks are written with XlsxWriter and openpyxl, so no fixture depends
on the JavaScript spreadsheet library under test. Re-run only to change a
fixture (the .xlsx files are committed):

    uv run --with xlsxwriter --with openpyxl python -I make_fixtures.py

Pass `--large OUT.xlsx [ROWS]` to write the big performance sheet (not
committed; 50,000 rows by default).
"""

import datetime as dt
import sys
from pathlib import Path

import openpyxl
import xlsxwriter

HERE = Path(__file__).resolve().parent

if sys.argv[1:2] in (["-h"], ["--help"]):
    print(__doc__)
    sys.exit(0)


def types() -> None:
    wb = xlsxwriter.Workbook(HERE / "types.xlsx")
    ws = wb.add_worksheet("Data")
    f_date = wb.add_format({"num_format": "yyyy-mm-dd"})
    f_dt = wb.add_format({"num_format": "yyyy-mm-dd hh:mm:ss"})
    f_dt_ms = wb.add_format({"num_format": "yyyy-mm-dd hh:mm:ss.000"})
    f_dmy = wb.add_format({"num_format": "d/m/yyyy"})
    f_time = wb.add_format({"num_format": "hh:mm:ss"})
    f_pct = wb.add_format({"num_format": "0.00%"})
    f_money = wb.add_format({"num_format": "#,##0.00 [$EUR]"})
    f_zip = wb.add_format({"num_format": "00000"})
    f_text = wb.add_format({"num_format": "@"})
    bold = wb.add_format({"bold": True})
    red = wb.add_format({"font_color": "red"})

    headers = [
        "text", "int", "float", "bool", "date", "datetime", "formula_num",
        "formula_str", "rich", "empty", "unicode", "percent", "time", "formula_err",
        "date_dmy", "big", "negative", "numeric_string", "spaces", "multiline",
        "money", "zip", "formula_bool", "datetime_ms", "text_fmt_number",
    ]
    for c, h in enumerate(headers):
        ws.write_string(0, c, h)

    rows = [
        {
            "text": "Alice", "int": 42, "float": 3.14, "bool": True,
            "date": dt.datetime(2024, 3, 15), "datetime": dt.datetime(2024, 3, 15, 13, 45, 30),
            "unicode": "Zoë Ångström", "percent": 0.256, "time": dt.time(13, 45, 30),
            "date_dmy": dt.datetime(2024, 12, 31), "big": 12345678901234567, "negative": -7.5,
            "numeric_string": "007", "spaces": "  padded  ", "multiline": "line1\nline2",
            "money": 1234.5, "zip": 501, "datetime_ms": dt.datetime(2024, 3, 15, 13, 45, 30, 500000),
            "text_fmt_number": 12345,
        },
        {
            "text": "Bob, \"Jr\"", "int": 0, "float": -0.5, "bool": False,
            "date": dt.datetime(1999, 12, 31), "datetime": dt.datetime(1970, 1, 1, 0, 0, 0),
            "unicode": "日本語 😀 עברית", "percent": 1, "time": dt.time(0, 0, 1),
            "date_dmy": dt.datetime(2000, 2, 29), "big": 1e21, "negative": -100,
            "numeric_string": "1e5", "spaces": "x", "multiline": "single",
            "money": 0, "zip": 99999, "datetime_ms": dt.datetime(2000, 1, 1, 0, 0, 0, 999000),
            "text_fmt_number": 7,
        },
    ]
    for r, row in enumerate(rows, start=1):
        ws.write_string(r, 0, row["text"], bold if r == 1 else None)
        ws.write_number(r, 1, row["int"])
        ws.write_number(r, 2, row["float"])
        ws.write_boolean(r, 3, row["bool"])
        ws.write_datetime(r, 4, row["date"], f_date)
        ws.write_datetime(r, 5, row["datetime"], f_dt)
        ws.write_formula(r, 6, f"=B{r + 1}*2", None, row["int"] * 2)
        ws.write_formula(r, 7, f'=A{r + 1}&"!"', None, row["text"] + "!")
        if r == 1:
            ws.write_rich_string(r, 8, "plain ", bold, "bold", red, " red", " tail")
        else:
            ws.write_rich_string(r, 8, bold, "all-bold", " then plain")
        ws.write_blank(r, 9, None, bold)
        ws.write_string(r, 10, row["unicode"])
        ws.write_number(r, 11, row["percent"], f_pct)
        ws.write_datetime(r, 12, row["time"], f_time)
        ws.write_formula(r, 13, f"=1/{r - 1}" if r == 1 else "=1/1", None, "#DIV/0!" if r == 1 else 1)
        ws.write_datetime(r, 14, row["date_dmy"], f_dmy)
        ws.write_number(r, 15, row["big"])
        ws.write_number(r, 16, row["negative"])
        ws.write_string(r, 17, row["numeric_string"])
        ws.write_string(r, 18, row["spaces"])
        ws.write_string(r, 19, row["multiline"])
        ws.write_number(r, 20, row["money"], f_money)
        ws.write_number(r, 21, row["zip"], f_zip)
        ws.write_formula(r, 22, f"=D{r + 1}", None, row["bool"])
        ws.write_datetime(r, 23, row["datetime_ms"], f_dt_ms)
        ws.write_number(r, 24, row["text_fmt_number"], f_text)

    other = wb.add_worksheet("Other")
    other.write_row(0, 0, ["ignored", "sheet"])
    other.write_row(1, 0, ["never", "read"])
    wb.close()


def sparse() -> None:
    wb = xlsxwriter.Workbook(HERE / "sparse.xlsx")
    ws = wb.add_worksheet("Sparse")
    bold = wb.add_format({"bold": True})
    ws.write_string(0, 0, "a")
    ws.write_blank(0, 1, None, bold)
    ws.write_string(0, 2, "c")
    ws.write_string(0, 3, "d")
    ws.write_row(1, 0, ["1", "2", "3", "4"])
    ws.write_string(3, 2, "only-c")
    ws.write_string(4, 0, "only-a")
    ws.write_row(5, 0, ["x", "y", "z", "w", "ragged1", "ragged2"])
    ws.write_blank(6, 0, None, bold)
    ws.write_row(7, 0, ["last", "", "", ""])
    wb.close()

    wb = xlsxwriter.Workbook(HERE / "blank-first-row.xlsx")
    ws = wb.add_worksheet("S")
    ws.write_row(1, 0, ["h1", "h2"])
    ws.write_row(2, 0, ["v1", "v2"])
    wb.close()

    wb = xlsxwriter.Workbook(HERE / "header-only.xlsx")
    ws = wb.add_worksheet("S")
    ws.write_row(0, 0, ["h1", "h2"])
    wb.close()

    wb = xlsxwriter.Workbook(HERE / "empty-first-sheet.xlsx")
    wb.add_worksheet("Empty")
    ws2 = wb.add_worksheet("Second")
    ws2.write_row(0, 0, ["h"])
    ws2.write_row(1, 0, ["v"])
    wb.close()


def offset_and_dates() -> None:
    wb = xlsxwriter.Workbook(HERE / "offset.xlsx")
    ws = wb.add_worksheet("Offset")
    ws.write_row(0, 2, ["h1", "h2"])
    ws.write_row(1, 2, ["a", "b"])
    ws.write_string(3, 1, "z")
    wb.close()

    wb = xlsxwriter.Workbook(HERE / "date-formats.xlsx")
    ws = wb.add_worksheet("Dates")
    ws.write_row(0, 0, ["label", "value"])
    cases = [
        ("serial 0.5, hh:mm", 0.5, "hh:mm"),
        ("serial 1, yyyy-mm-dd", 1, "yyyy-mm-dd"),
        ("serial 59, yyyy-mm-dd", 59, "yyyy-mm-dd"),
        ("serial 60 (1900-02-29), yyyy-mm-dd", 60, "yyyy-mm-dd"),
        ("serial 61, yyyy-mm-dd", 61, "yyyy-mm-dd"),
        ("serial 2958465, yyyy-mm-dd", 2958465, "yyyy-mm-dd"),
        ("builtin id 14", 45366, 14),
        ("mmm d, yyyy", 45366, "mmm d, yyyy"),
        ("locale tag", 45366, "[$-409]d-mmm-yy"),
        ("mm:ss", 0.0123, "mm:ss"),
        ("elapsed [h]:mm:ss", 1.5, "[h]:mm:ss"),
        ("quoted d is not a date", 45366, '0 "d"'),
        ("General", 45366, "General"),
        ("text format", 45366, "@"),
        ("seconds 23:59:59", 45292.99998842592, "yyyy-mm-dd hh:mm:ss"),
        ("seconds 10:20:30", 45292.43090277778, "yyyy-mm-dd hh:mm:ss"),
    ]
    for i, (label, value, fmt) in enumerate(cases, start=1):
        ws.write_string(i, 0, label)
        if isinstance(fmt, int):
            ws.write_number(i, 1, value, wb.add_format({"num_format": fmt}))
        else:
            ws.write_number(i, 1, value, wb.add_format({"num_format": fmt}))
    wb.close()


def links_merged_hidden() -> None:
    wb = xlsxwriter.Workbook(HERE / "links-merged.xlsx")
    ws = wb.add_worksheet("Links")
    ws.write_row(0, 0, ["link", "merged", "after"])
    ws.write_url(1, 0, "https://example.org/a", string="example link")
    ws.merge_range(1, 1, 1, 2, "merged value")
    ws.write_url(2, 0, "mailto:a@example.org", string="mail me")
    ws.write_url(3, 0, "internal:Links!A1", string="jump")
    ws.write_string(3, 1, "x")
    ws.write_string(3, 2, "y")
    wb.close()

    wb = xlsxwriter.Workbook(HERE / "hidden-first.xlsx")
    first = wb.add_worksheet("Hidden")
    second = wb.add_worksheet("Visible")
    first.write_row(0, 0, ["from"])
    first.write_row(1, 0, ["hidden sheet"])
    second.write_row(0, 0, ["from"])
    second.write_row(1, 0, ["visible sheet"])
    second.activate()
    first.hide()
    wb.close()


def unicode_book() -> None:
    wb = xlsxwriter.Workbook(HERE / "unicode.xlsx")
    ws = wb.add_worksheet("Φύλλο")
    ws.write_row(0, 0, ["name", "城市", "ملاحظة", "emoji"])
    ws.write_row(1, 0, ["José", "東京", "مرحبا", "😀🎉"])
    ws.write_row(2, 0, ["Zoë (combining)", "Zürich", "a​b (zero-width)", "👨‍👩‍👧"])
    ws.write_row(3, 0, ["x" * 30000, "<>&\"'", "tab\there", "line\r\nbreak"])
    wb.close()


def date1904() -> None:
    wb = xlsxwriter.Workbook(HERE / "date1904.xlsx", {"date_1904": True})
    ws = wb.add_worksheet("S")
    f = wb.add_format({"num_format": "yyyy-mm-dd hh:mm:ss"})
    ws.write_row(0, 0, ["when"])
    ws.write_datetime(1, 0, dt.datetime(2024, 3, 15, 13, 45, 30), f)
    ws.write_datetime(2, 0, dt.datetime(1999, 12, 31, 0, 0, 0), f)
    wb.close()


def openpyxl_book() -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Op"
    ws.append(["text", "int", "float", "bool", "date", "datetime", "formula_no_cache", "none"])
    ws.append(["alpha", 1, 1.5, True, dt.date(2024, 3, 15), dt.datetime(2024, 3, 15, 13, 45, 30), "=B2+1", None])
    ws.append(["beta", 2, 2.5, False, dt.datetime(2023, 1, 1), dt.datetime(2023, 1, 1, 23, 59, 59), "=B3+1", None])
    wb.save(HERE / "openpyxl-made.xlsx")


def large(out: Path, n: int) -> None:
    wb = xlsxwriter.Workbook(out, {"constant_memory": True})
    ws = wb.add_worksheet("Big")
    f_date = wb.add_format({"num_format": "yyyy-mm-dd"})
    ws.write_row(0, 0, ["id", "name", "email", "amount", "when", "flag"])
    base = dt.datetime(2020, 1, 1)
    for i in range(1, n + 1):
        ws.write_number(i, 0, i)
        ws.write_string(i, 1, f"Person {i}")
        ws.write_string(i, 2, f"person{i}@example.org")
        ws.write_number(i, 3, i * 1.25)
        ws.write_datetime(i, 4, base + dt.timedelta(days=i % 1000), f_date)
        ws.write_boolean(i, 5, i % 2 == 0)
    wb.close()


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--large":
        large(Path(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 50_000)
    else:
        types()
        sparse()
        offset_and_dates()
        links_merged_hidden()
        unicode_book()
        date1904()
        openpyxl_book()
