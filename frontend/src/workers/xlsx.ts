import { readXlsx, writeXlsx } from 'hucre/xlsx';
import type { Cell, Rows } from '../types/data';
import { MAX_XLSX_ENTRY_BYTES } from '../lib/constants';
import { SHEET_NAME, sheetRowsOf, type SheetRows } from './sheet-rows';

const FIRST_UNAFFECTED_MS = Date.UTC(1900, 2, 1);
const DAY_MS = 86_400_000;

const isoOf = (d: Date): string | null => {
    const t = d.getTime();
    if (Number.isNaN(t)) return null;
    return new Date(t < FIRST_UNAFFECTED_MS ? t - DAY_MS : t).toISOString();
};

export const readFirstSheet = async (buffer: ArrayBuffer): Promise<SheetRows> => {
    const workbook = await readXlsx(new Uint8Array(buffer), {
        sheets: [0],
        maxDecompressedBytes: MAX_XLSX_ENTRY_BYTES,
    });
    const sheet = workbook.sheets[0];
    if (!sheet) throw new Error('No sheets found');

    return sheetRowsOf(sheet.rows, isoOf);
};

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const ERROR_LITERAL = /^#(?:VALUE!|REF!|N\/A|NAME\?|NULL!|DIV\/0!|NUM!|GETTING_DATA|SPILL!|CALC!)$/;

const outCell = (v: Cell): Cell | { richText: { text: string }[] } =>
    typeof v === 'string' && v.startsWith('#') && ERROR_LITERAL.test(v)
        ? { richText: [{ text: v }] }
        : v;

export const writeSheet = async (headers: string[], data: Rows): Promise<Blob> => {
    const rows = [headers.map(outCell), ...data.map((row) => row.map(outCell))];
    const bytes = await writeXlsx({ sheets: [{ name: SHEET_NAME, rows }] });
    return new Blob([bytes as BlobPart], { type: XLSX_MIME });
};
