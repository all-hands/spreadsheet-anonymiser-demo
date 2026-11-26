"""Reads an .ods from stdin with odfpy and prints its first sheet as JSON, so a
test can check what another application sees in a file the app wrote.

    uv run --no-project --with odfpy python -I read_back_ods.py < FILE.ods

Output: {"sheets": [names], "rows": [[[value_type, value], ...], ...]}.
"""

import io
import json
import sys

from odf import teletype
from odf.opendocument import load
from odf.table import Table, TableCell, TableRow
from odf.text import P

if sys.argv[1:2] in (["-h"], ["--help"]):
    print(__doc__)
    sys.exit(0)

tables = load(io.BytesIO(sys.stdin.buffer.read())).spreadsheet.getElementsByType(Table)


def cell(c):
    kind = c.getAttribute("valuetype")
    if kind == "float":
        return [kind, float(c.getAttribute("value"))]
    if kind == "boolean":
        return [kind, c.getAttribute("booleanvalue")]
    return [kind, "\n".join(teletype.extractText(p) for p in c.getElementsByType(P))]


rows = [[cell(c) for c in r.getElementsByType(TableCell)] for r in tables[0].getElementsByType(TableRow)]
json.dump({"sheets": [t.getAttribute("name") for t in tables], "rows": rows}, sys.stdout, ensure_ascii=False)
