// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./wasm', () => ({ ensureWasm: vi.fn(async () => {}) }));

import { parseFile } from './parse';
import { generateFile } from './generate';
import type { Rows } from '../types/data';

const fixtureBytes = (name: string): Uint8Array =>
    new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
const fixture = (name: string): File => new File([fixtureBytes(name) as BlobPart], name);

describe('parseFile: .xlsx cell types (types.xlsx, first sheet only)', () => {
    it('reads the header row and one value per type', async () => {
        const r = await parseFile(fixture('types.xlsx'));

        expect(r.headers).toEqual([
            'text', 'int', 'float', 'bool', 'date', 'datetime', 'formula_num', 'formula_str', 'rich',
            'empty', 'unicode', 'percent', 'time', 'formula_err', 'date_dmy', 'big', 'negative',
            'numeric_string', 'spaces', 'multiline', 'money', 'zip', 'formula_bool', 'datetime_ms',
            'text_fmt_number',
        ]);
        expect(r.data).toHaveLength(2);
        expect(r.metadata.map((m) => m.header)).toEqual(r.headers);
    });

    it('keeps strings, numbers and booleans as they are', async () => {
        const [row1, row2] = (await parseFile(fixture('types.xlsx'))).data;
        const col = (name: string, row: Rows[number]): unknown =>
            row[['text', 'int', 'float', 'bool', 'date', 'datetime', 'formula_num', 'formula_str', 'rich',
                'empty', 'unicode', 'percent', 'time', 'formula_err', 'date_dmy', 'big', 'negative',
                'numeric_string', 'spaces', 'multiline', 'money', 'zip', 'formula_bool', 'datetime_ms',
                'text_fmt_number'].indexOf(name)];

        expect(col('text', row1)).toBe('Alice');
        expect(col('text', row2)).toBe('Bob, "Jr"');
        expect(col('int', row1)).toBe(42);
        expect(col('int', row2)).toBe(0);
        expect(col('float', row1)).toBe(3.14);
        expect(col('float', row2)).toBe(-0.5);
        expect(col('bool', row1)).toBe(true);
        expect(col('bool', row2)).toBe(false);
        expect(col('unicode', row1)).toBe('Zoë Ångström');
        expect(col('unicode', row2)).toBe('日本語 😀 עברית');
        expect(col('numeric_string', row1)).toBe('007');
        expect(col('numeric_string', row2)).toBe('1e5');
        expect(col('spaces', row1)).toBe('  padded  ');
        expect(col('multiline', row1)).toBe('line1\nline2');
        expect(col('big', row1)).toBe(1.234567890123457e16);
        expect(col('big', row2)).toBe(1e21);
        expect(col('negative', row1)).toBe(-7.5);
        expect(col('percent', row1)).toBe(0.256);
        expect(col('money', row1)).toBe(1234.5);
        expect(col('zip', row1)).toBe(501);
        expect(col('text_fmt_number', row1)).toBe(12345);
    });

    it('flattens rich text to its plain characters and leaves empty cells empty', async () => {
        const [row1, row2] = (await parseFile(fixture('types.xlsx'))).data;
        expect(row1[8]).toBe('plain bold red tail');
        expect(row2[8]).toBe('all-bold then plain');
        expect(row1[9] ?? null).toBeNull();
    });

    it('turns date and date-time cells into ISO-8601 UTC strings', async () => {
        const [row1, row2] = (await parseFile(fixture('types.xlsx'))).data;
        expect(row1[4]).toBe('2024-03-15T00:00:00.000Z');
        expect(row1[5]).toBe('2024-03-15T13:45:30.000Z');
        expect(row2[4]).toBe('1999-12-31T00:00:00.000Z');
        expect(row2[5]).toBe('1970-01-01T00:00:00.000Z');
        expect(row1[14]).toBe('2024-12-31T00:00:00.000Z');
        expect(row2[14]).toBe('2000-02-29T00:00:00.000Z');
        expect(row1[23]).toBe('2024-03-15T13:45:30.500Z');
        expect(row2[23]).toBe('2000-01-01T00:00:00.999Z');
    });

    it('turns a time-only cell into a 1899-12-30 UTC date-time', async () => {
        const [row1, row2] = (await parseFile(fixture('types.xlsx'))).data;
        expect(row1[12]).toBe('1899-12-30T13:45:30.000Z');
        expect(row2[12]).toBe('1899-12-30T00:00:01.000Z');
    });

    it('does not depend on the machine time zone', async () => {
        const before = process.env.TZ;
        const results: string[] = [];
        try {
            for (const tz of ['UTC', 'Pacific/Auckland', 'America/Los_Angeles', 'Asia/Kolkata']) {
                process.env.TZ = tz;
                const r = await parseFile(fixture('types.xlsx'));
                results.push(JSON.stringify([r.data[0][4], r.data[0][5], r.data[1][5], r.data[0][12]]));
            }
        } finally {
            if (before === undefined) delete process.env.TZ;
            else process.env.TZ = before;
        }
        expect(new Set(results).size).toBe(1);
        expect(JSON.parse(results[0])).toEqual([
            '2024-03-15T00:00:00.000Z',
            '2024-03-15T13:45:30.000Z',
            '1970-01-01T00:00:00.000Z',
            '1899-12-30T13:45:30.000Z',
        ]);
    });

    it('reads a formula cell as its cached result, and an error result as its text', async () => {
        const [row1, row2] = (await parseFile(fixture('types.xlsx'))).data;
        expect([row1[6], row2[6]]).toEqual([84, 0]);
        expect([row1[7], row2[7]]).toEqual(['Alice!', 'Bob, "Jr"!']);
        expect([row1[13], row2[13]]).toEqual(['#DIV/0!', 1]);
        expect([row1[22], row2[22]]).toEqual([true, false]);
    });

    it('reads a formula that has no cached result as an empty cell', async () => {
        const r = await parseFile(fixture('openpyxl-made.xlsx'));
        expect(r.data.map((row) => row[6] ?? null)).toEqual([null, null]);
    });

    it('only reads the first sheet', async () => {
        const r = await parseFile(fixture('types.xlsx'));
        expect(JSON.stringify(r)).not.toContain('never');
        expect(JSON.stringify(r)).not.toContain('ignored');

        const second = await parseFile(fixture('empty-first-sheet.xlsx'));
        expect(second.headers).toEqual([]);
        expect(second.data).toEqual([]);
    });

    it('hashes the original bytes with SHA-256', async () => {
        const r = await parseFile(fixture('types.xlsx'));
        expect(r.fileHash).toBe(createHash('sha256').update(fixtureBytes('types.xlsx')).digest('hex'));
        expect(r.streamed).toBeUndefined();
    });
});

describe('parseFile: .xlsx date formats (date-formats.xlsx)', () => {
    it('decides date versus number by the number format', async () => {
        const r = await parseFile(fixture('date-formats.xlsx'));
        const byLabel = Object.fromEntries(r.data.map((row) => [row[0] as string, row[1]]));

        expect(byLabel['builtin id 14']).toBe('2024-03-15T00:00:00.000Z');
        expect(byLabel['mmm d, yyyy']).toBe('2024-03-15T00:00:00.000Z');
        expect(byLabel['locale tag']).toBe('2024-03-15T00:00:00.000Z');
        expect(byLabel['serial 61, yyyy-mm-dd']).toBe('1900-03-01T00:00:00.000Z');
        expect(byLabel['serial 2958465, yyyy-mm-dd']).toBe('9999-12-31T00:00:00.000Z');
        expect(byLabel['seconds 23:59:59']).toBe('2024-01-01T23:59:59.000Z');
        expect(byLabel['seconds 10:20:30']).toBe('2024-01-01T10:20:30.000Z');
        expect(byLabel['quoted d is not a date']).toBe(45366);
        expect(byLabel['General']).toBe(45366);
        expect(byLabel['text format']).toBe(45366);
    });

    it('uses the 1899-12-30 epoch below 1900-03-01 (time-only cells, Excel 1900-02-29 quirk range)', async () => {
        const r = await parseFile(fixture('date-formats.xlsx'));
        const byLabel = Object.fromEntries(r.data.map((row) => [row[0] as string, row[1]]));

        expect(byLabel['serial 0.5, hh:mm']).toBe('1899-12-30T12:00:00.000Z');
        expect(byLabel['serial 1, yyyy-mm-dd']).toBe('1899-12-31T00:00:00.000Z');
        expect(byLabel['serial 59, yyyy-mm-dd']).toBe('1900-02-27T00:00:00.000Z');
        expect(byLabel['serial 60 (1900-02-29), yyyy-mm-dd']).toBe('1900-02-27T00:00:00.000Z');
        expect(byLabel['mm:ss']).toBe('1899-12-30T00:17:42.720Z');
        expect(byLabel['elapsed [h]:mm:ss']).toBe('1899-12-31T12:00:00.000Z');
    });

    it('reads the 1904 date system', async () => {
        const r = await parseFile(fixture('date1904.xlsx'));
        expect(r.headers).toEqual(['when']);
        expect(r.data).toEqual([['2024-03-15T13:45:30.000Z'], ['1999-12-31T00:00:00.000Z']]);
    });

    it('reads dates and date-times written by openpyxl', async () => {
        const r = await parseFile(fixture('openpyxl-made.xlsx'));
        expect(r.headers).toEqual(['text', 'int', 'float', 'bool', 'date', 'datetime', 'formula_no_cache', 'none']);
        expect(r.data.map((row) => row.slice(0, 6))).toEqual([
            ['alpha', 1, 1.5, true, '2024-03-15T00:00:00.000Z', '2024-03-15T13:45:30.000Z'],
            ['beta', 2, 2.5, false, '2023-01-01T00:00:00.000Z', '2023-01-01T23:59:59.000Z'],
        ]);
    });
});

describe('parseFile: .xlsx sparse, ragged and odd layouts', () => {
    it('keeps cells in their own columns when the first columns are empty', async () => {
        const r = await parseFile(fixture('offset.xlsx'));
        expect(r.headers).toEqual(['', '', 'h1', 'h2']);
        expect(r.data).toEqual([[null, null, 'a', 'b'], [null, 'z']]);
    });

    it('drops rows with no cells, trims trailing blanks and keeps ragged rows ragged', async () => {
        const r = await parseFile(fixture('sparse.xlsx'));
        expect(r.headers).toEqual(['a', '', 'c', 'd']);
        expect(r.data).toEqual([
            ['1', '2', '3', '4'],
            [null, null, 'only-c'],
            ['only-a'],
            ['x', 'y', 'z', 'w', 'ragged1', 'ragged2'],
            ['last'],
        ]);
        expect(r.metadata).toHaveLength(4);
    });

    it('reads a hyperlink as its display text and a merged range as one value in its first cell', async () => {
        const r = await parseFile(fixture('links-merged.xlsx'));
        expect(r.headers).toEqual(['link', 'merged', 'after']);
        expect(r.data).toEqual([
            ['example link', 'merged value'],
            ['mail me'],
            ['jump', 'x', 'y'],
        ]);
    });

    it('reads the first sheet in tab order, hidden or not', async () => {
        const r = await parseFile(fixture('hidden-first.xlsx'));
        expect(r.data).toEqual([['hidden sheet']]);
    });

    it('takes row 1 of the sheet as the header even when it is empty', async () => {
        const r = await parseFile(fixture('blank-first-row.xlsx'));
        expect(r.headers).toEqual([]);
        expect(r.data).toEqual([['h1', 'h2'], ['v1', 'v2']]);
    });

    it('reads a header-only sheet as no data rows', async () => {
        const r = await parseFile(fixture('header-only.xlsx'));
        expect(r.headers).toEqual(['h1', 'h2']);
        expect(r.data).toEqual([]);
        expect(r.metadata.map((m) => m.type)).toEqual(['text', 'text']);
    });
});

describe('parseFile: .xlsx Unicode', () => {
    it('reads a non-Latin sheet name, scripts, emoji, markup characters and 30,000-character cells', async () => {
        const r = await parseFile(fixture('unicode.xlsx'));
        expect(r.headers).toEqual(['name', '城市', 'ملاحظة', 'emoji']);
        expect(r.data[0]).toEqual(['José', '東京', 'مرحبا', '😀🎉']);
        expect(r.data[1][0]).toBe('Zoë (combining)');
        expect(r.data[1][1]).toBe('Zürich');
        expect(r.data[1][2]).toBe('a​b (zero-width)');
        expect(r.data[1][3]).toBe('👨‍👩‍👧');
        expect(r.data[2][0]).toBe('x'.repeat(30000));
        expect(r.data[2][1]).toBe('<>&"\'');
        expect(r.data[2][2]).toBe('tab\there');
    });
});

describe('parseFile: .xlsx errors', () => {
    it('wraps a parser failure as "Excel parse failed: ..."', async () => {
        const bad = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'broken.xlsx');
        await expect(parseFile(bad)).rejects.toThrow(/^Excel parse failed: /);
    });

    it('rejects a text file renamed to .xlsx the same way', async () => {
        const bad = new File(['id,name\n1,Ann\n'], 'renamed.xlsx');
        await expect(parseFile(bad)).rejects.toThrow(/^Excel parse failed: /);
    });
});

describe('parseFile: .xlsx at scale', () => {
    it('parses 50,000 rows', async () => {
        const rows: Rows = Array.from({ length: 50_000 }, (_, i) => [
            i + 1,
            `Person ${i + 1}`,
            `person${i + 1}@example.org`,
            (i + 1) * 1.25,
            i % 2 === 0,
        ]);
        const blob = await generateFile(['id', 'name', 'email', 'amount', 'flag'], rows, 'xlsx');
        const file = new File([blob], 'big.xlsx');

        const t0 = performance.now();
        const r = await parseFile(file);
        const ms = performance.now() - t0;
        console.info(`parse 50,000-row xlsx (${(blob.size / 1e6).toFixed(2)} MB): ${ms.toFixed(0)} ms`);

        expect(r.headers).toEqual(['id', 'name', 'email', 'amount', 'flag']);
        expect(r.data).toHaveLength(50_000);
        expect(r.data[0]).toEqual([1, 'Person 1', 'person1@example.org', 1.25, true]);
        expect(r.data[49_999]).toEqual([50_000, 'Person 50000', 'person50000@example.org', 62_500, false]);
        expect(r.metadata[2].type).toBe('email');
    }, 120_000);
});
