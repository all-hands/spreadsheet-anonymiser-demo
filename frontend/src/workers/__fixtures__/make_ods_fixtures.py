"""Builds the .ods fixtures next to this file with odfpy, so no fixture depends
on the JavaScript spreadsheet library under test. Re-run only to change one:

    uv run --no-project --with odfpy python -I make_ods_fixtures.py
"""

import sys
from pathlib import Path

from odf.opendocument import OpenDocumentSpreadsheet
from odf.office import Annotation
from odf.table import CoveredTableCell, Table, TableCell, TableHeaderRows, TableRow, TableRowGroup
from odf.text import A, LineBreak, P, S, Span, Tab

HERE = Path(__file__).resolve().parent

if sys.argv[1:2] in (["-h"], ["--help"]):
    print(__doc__)
    sys.exit(0)


def text(value: str) -> TableCell:
    cell = TableCell(valuetype="string")
    cell.addElement(P(text=value))
    return cell


def row(*cells, **attrs) -> TableRow:
    r = TableRow(**attrs)
    for c in cells:
        r.addElement(text(c) if isinstance(c, str) else c)
    return r


def typed(valuetype: str, shown: str, **attrs) -> TableCell:
    cell = TableCell(valuetype=valuetype, **attrs)
    cell.addElement(P(text=shown))
    return cell


def types() -> None:
    doc = OpenDocumentSpreadsheet()
    t = Table(name="Data")
    t.addElement(row("text", "number", "bool", "date", "datetime", "time", "long_time", "percent",
                     "money", "rich", "spaces", "multiline", "duration_text", "gap", "formula", "note"))
    rich = TableCell(valuetype="string")
    p = P(text="plain ")
    p.addElement(Span(text="bold"))
    p.addElement(A(href="https://example.org/", text=" link"))
    rich.addElement(p)
    spaces = TableCell(valuetype="string")
    p = P()
    p.addElement(S(c=2))
    p.addText("padded")
    p.addElement(Tab())
    p.addElement(S(c=1))
    spaces.addElement(p)
    multi = TableCell(valuetype="string")
    p = P(text="line1")
    p.addElement(LineBreak())
    p.addText("line2")
    multi.addElement(p)
    multi.addElement(P(text="line3"))
    noted = TableCell(valuetype="string")
    note = Annotation()
    note.addElement(P(text="secret comment"))
    noted.addElement(note)
    noted.addElement(P(text="shown"))
    t.addElement(row(
        "Zoë 日本語", typed("float", "3.14", value="3.14"),
        typed("boolean", "TRUE", booleanvalue="true"),
        typed("date", "15/03/24", datevalue="2024-03-15"),
        typed("date", "15/03/24 13:45", datevalue="2024-03-15T13:45:30.500000000"),
        typed("time", "01:45 PM", timevalue="PT13H45M30S"),
        typed("time", "36:00", timevalue="PT36H00M00S"),
        typed("percentage", "25.6%", value="0.256"),
        typed("currency", "EUR 1,234.50", value="1234.5", currency="EUR"),
        rich, spaces, multi, "PT1H", TableCell(),
        typed("float", "6.28", value="6.28", formula="of:=IF([.B2]>1;[.B2]*2;0)"), noted,
    ))
    t.addElement(row(TableCell(numbercolumnsrepeated=16384), numberrowsrepeated=1048574))
    doc.spreadsheet.addElement(t)
    other = Table(name="Other")
    other.addElement(row("not", "read"))
    doc.spreadsheet.addElement(other)
    doc.save(HERE / "types.ods")


def grouped() -> None:
    doc = OpenDocumentSpreadsheet()
    t = Table(name="People")
    head = TableHeaderRows()
    head.addElement(row("name", "city"))
    t.addElement(head)
    t.addElement(row("Alice", "Leeds"))
    outer, inner = TableRowGroup(), TableRowGroup(display="false")
    inner.addElement(row("Bob", "York", numberrowsrepeated=2))
    outer.addElement(inner)
    outer.addElement(row("Cy", "Bath"))
    t.addElement(outer)
    t.addElement(row(typed("string", "merged", numbercolumnsspanned=2, numberrowsspanned=1), CoveredTableCell()))
    t.addElement(row(text("<table:table-rows>"), TableCell(numbercolumnsrepeated=2), text("far")))
    doc.spreadsheet.addElement(t)
    doc.save(HERE / "grouped.ods")


def small() -> None:
    doc = OpenDocumentSpreadsheet()
    t = Table(name="Empty")
    doc.spreadsheet.addElement(t)
    other = Table(name="Other")
    other.addElement(row("not", "read"))
    doc.spreadsheet.addElement(other)
    doc.save(HERE / "empty-first-sheet.ods")

    doc = OpenDocumentSpreadsheet()
    t = Table(name="Blank")
    t.addElement(row(TableCell()))
    t.addElement(row("a", "b"))
    doc.spreadsheet.addElement(t)
    doc.save(HERE / "blank-first-row.ods")


types()
grouped()
small()
