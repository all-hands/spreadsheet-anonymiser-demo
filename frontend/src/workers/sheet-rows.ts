import type { Cell, Rows } from '../types/data';

export const SHEET_NAME = 'Anonymized';

export type Raw = string | number | boolean | Date | null | undefined;

export interface SheetRows {
    headers: string[];
    rows: Rows;
}

export const sheetRowsOf = (sheet: readonly (readonly Raw[])[], isoOf: (d: Date) => string | null): SheetRows => {
    let headers: string[] = [];
    const rows: Rows = [];
    sheet.forEach((raw, i) => {
        let last = raw.length - 1;
        while (last >= 0 && (raw[last] === null || raw[last] === undefined)) last--;
        if (last < 0) return;
        const cells: Cell[] = new Array(last + 1);
        for (let c = 0; c <= last; c++) {
            const v = raw[c];
            cells[c] = v === null || v === undefined ? null : v instanceof Date ? isoOf(v) : v;
        }
        if (i === 0) headers = cells.map((c) => (c === null ? '' : String(c)));
        else rows.push(cells);
    });
    return { headers, rows };
};
