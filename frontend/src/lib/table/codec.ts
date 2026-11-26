import { TableDecoder, encode_table_header, encode_table_rows } from '../../workers/wasm';
import type { Cell } from '../../types/data';

export type TextTableFormat = 'csv' | 'tsv' | 'jsonl';

export type EncodedBytes = Uint8Array<ArrayBuffer>;

export interface Decoded {
    headers: string[] | null;
    rows: string[][];
}

export interface RowDecoder {
    push(text: string, final: boolean): Decoded;
    free(): void;
}

const MAX_PUSH_UNITS = 1 << 20;

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;

const utf8 = new TextEncoder();
const NO_BYTES = new Uint8Array(0);
let scratch = new Uint8Array(0);
const toUtf8 = (s: string): Uint8Array => {
    if (scratch.length < s.length * 3) scratch = new Uint8Array(Math.max(s.length * 3, scratch.length * 2));
    return scratch.subarray(0, utf8.encodeInto(s, scratch).written);
};

export const createRowDecoder = (format: TextTableFormat): RowDecoder => {
    let dec: TableDecoder | null = new TableDecoder(format);
    let announced = false;
    let started = false;
    let pendingHigh = '';
    const free = () => {
        dec?.free();
        dec = null;
    };
    const take = (d: TableDecoder, into: string[][], cells: string) => {
        const n = d.row_count();
        if (n === 0) return;
        const ends = d.cell_ends();
        const width = ends.length / n;
        let start = 0;
        let k = 0;
        for (let r = 0; r < n; r++) {
            const row: string[] = [];
            for (let j = 0; j < width; j++) {
                const end = ends[k++];
                row.push(cells.slice(start, end));
                start = end;
            }
            into.push(row);
        }
    };
    return {
        push(text, final) {
            if (!dec) throw new Error('The table decoder was already closed.');
            try {
                text = pendingHigh + text;
                pendingHigh = '';
                if (!final && text.length > 0 && isHighSurrogate(text.charCodeAt(text.length - 1))) {
                    pendingHigh = text.slice(-1);
                    text = text.slice(0, -1);
                }
                if (!started && text.length > 0) {
                    started = true;
                    if (format === 'jsonl' && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
                }
                const rows: string[][] = [];
                for (let at = 0; at < text.length; ) {
                    let end = Math.min(at + MAX_PUSH_UNITS, text.length);
                    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end--;
                    take(dec, rows, dec.push(toUtf8(text.slice(at, end)), false));
                    at = end;
                }
                if (final) take(dec, rows, dec.push(NO_BYTES, true));
                let headers: string[] | null = null;
                if (!announced) {
                    headers = dec.headers() ?? null;
                    announced = headers !== null;
                }
                if (final) free();
                return { headers, rows };
            } catch (e) {
                free();
                throw e;
            }
        },
        free,
    };
};

const cellText = (c: Cell): string => (c === null || c === undefined ? '' : String(c));

export const encodeHeader = (format: TextTableFormat, headers: readonly string[]): EncodedBytes =>
    encode_table_header(format, [...headers]) as EncodedBytes;

const ENCODE_BATCH_ROWS = 4096;

export const encodeRows = (
    format: TextTableFormat,
    headers: readonly string[],
    rows: readonly (readonly Cell[])[]
): EncodedBytes[] => {
    const h = [...headers];
    const out: EncodedBytes[] = [];
    for (let at = 0; at < rows.length; at += ENCODE_BATCH_ROWS) {
        const batch = rows.slice(at, at + ENCODE_BATCH_ROWS);
        let total = 0;
        for (const row of batch) total += row.length;
        const parts = new Array<string>(total);
        const cellEnds = new Uint32Array(total);
        const rowEnds = new Uint32Array(batch.length);
        let units = 0;
        let k = 0;
        for (let r = 0; r < batch.length; r++) {
            for (const c of batch[r]) {
                const s = typeof c === 'string' ? c : cellText(c);
                parts[k] = s;
                units += s.length;
                cellEnds[k++] = units;
            }
            rowEnds[r] = k;
        }
        out.push(encode_table_rows(format, h, toUtf8(parts.join('')), cellEnds, rowEnds) as EncodedBytes);
    }
    return out;
};
