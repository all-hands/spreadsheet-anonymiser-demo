"""Reads an .xlsx with openpyxl and prints it as JSON, so a test can check what
another spreadsheet application sees in a file the app wrote.

    uv run --with openpyxl python -I read_back.py FILE.xlsx

Output: {"sheets": [names], "rows": [[[data_type, value], ...], ...]} for the
first sheet. data_type is openpyxl's: "s" string, "n" number, "b" boolean,
"d" date, "f" formula, "e" error. An empty cell is ["n", null].
"""

import json
import sys
import warnings

import openpyxl

warnings.simplefilter("ignore")

if sys.argv[1:2] in (["-h"], ["--help"]):
    print(__doc__)
    sys.exit(0)

wb = openpyxl.load_workbook(sys.argv[1])
ws = wb[wb.sheetnames[0]]
rows = [[[c.data_type, c.value] for c in row] for row in ws.iter_rows()]
json.dump({"sheets": wb.sheetnames, "rows": rows}, sys.stdout, ensure_ascii=False)
