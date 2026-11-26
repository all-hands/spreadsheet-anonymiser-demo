// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./wasm', () => ({ ensureWasm: vi.fn(async () => {}) }));

import { generateFile } from './generate';
import { parseFile } from './parse';
import type { Rows } from '../types/data';

const headers = ['name', 'n', 'flag', 'note'];
const data: Rows = [
    ['Ann', 1, true, null],
    ['Bo, "Q"', 2.5, false, ''],
    ['=1+1', 0, true, 'x'],
    ['0123', -7, false, '1e5'],
    [' lead', 1e21, true, 'a\nb'],
    ['😀 日本語', 12345678901234, false, '<&>'],
    ['#N/A', 3, true, '#DIV/0!'],
];

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const hasUv = spawnSync('uv', ['--version']).status === 0;

describe('generateFile: .xlsx', () => {
    it('returns a zip (PK) blob with the spreadsheet MIME type', async () => {
        const blob = await generateFile(headers, data, 'xlsx');
        expect(blob.type).toBe(XLSX_MIME);
        const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
        expect([...head]).toEqual([0x50, 0x4b]);
    });

    it('round-trips through parseFile: typed values, header row, ragged blanks', async () => {
        const blob = await generateFile(headers, data, 'xlsx');
        const r = await parseFile(new File([blob], 'out.xlsx'));

        expect(r.headers).toEqual(headers);
        expect(r.data.map((row) => Array.from(row))).toEqual([
            ['Ann', 1, true],
            ['Bo, "Q"', 2.5, false, ''],
            ['=1+1', 0, true, 'x'],
            ['0123', -7, false, '1e5'],
            [' lead', 1e21, true, 'a\nb'],
            ['😀 日本語', 12345678901234, false, '<&>'],
            ['#N/A', 3, true, '#DIV/0!'],
        ]);
    });

    it('writes an empty table as a sheet with only the header row', async () => {
        const blob = await generateFile(headers, [], 'xlsx');
        const r = await parseFile(new File([blob], 'empty.xlsx'));
        expect(r.headers).toEqual(headers);
        expect(r.data).toEqual([]);
    });

    it.skipIf(!hasUv)('is read back by openpyxl: sheet name, header row, values and types', async () => {
        const blob = await generateFile(headers, data, 'xlsx');
        const dir = mkdtempSync(join(tmpdir(), 'anon-xlsx-'));
        try {
            const file = join(dir, 'out.xlsx');
            writeFileSync(file, new Uint8Array(await blob.arrayBuffer()));
            const script = fileURLToPath(new URL('./__fixtures__/read_back.py', import.meta.url));
            const run = spawnSync('uv', ['run', '--with', 'openpyxl', 'python', '-I', script, file], {
                encoding: 'utf8',
                maxBuffer: 64 * 1024 * 1024,
            });
            expect(run.status, run.stderr).toBe(0);
            const out = JSON.parse(run.stdout) as { sheets: string[]; rows: [string, unknown][][] };

            expect(out.sheets).toEqual(['Anonymized']);
            expect(out.rows).toHaveLength(1 + data.length);
            expect(out.rows[0].map(([t, v]) => [t, v])).toEqual(headers.map((h) => ['s', h]));
            const cell = (r: number, c: number): [string, unknown] => out.rows[r][c];
            expect(cell(1, 0)).toEqual(['s', 'Ann']);
            expect(cell(1, 1)).toEqual(['n', 1]);
            expect(cell(1, 2)).toEqual(['b', true]);
            expect(cell(1, 3)[1]).toBeNull();
            expect(cell(2, 0)).toEqual(['s', 'Bo, "Q"']);
            expect(cell(2, 1)).toEqual(['n', 2.5]);
            expect(cell(2, 2)).toEqual(['b', false]);
            expect(cell(3, 0)).toEqual(['s', '=1+1']);
            expect(cell(4, 0)).toEqual(['s', '0123']);
            expect(cell(4, 1)).toEqual(['n', -7]);
            expect(cell(4, 3)).toEqual(['s', '1e5']);
            expect(cell(5, 0)).toEqual(['s', ' lead']);
            expect(cell(5, 1)).toEqual(['n', 1e21]);
            expect(cell(5, 3)).toEqual(['s', 'a\nb']);
            expect(cell(6, 0)).toEqual(['s', '😀 日本語']);
            expect(cell(6, 1)).toEqual(['n', 12345678901234]);
            expect(cell(6, 3)).toEqual(['s', '<&>']);
            expect(cell(7, 0)).toEqual(['s', '#N/A']);
            expect(cell(7, 3)).toEqual(['s', '#DIV/0!']);
        } finally {
            rmSync(join(dir, 'out.xlsx'), { force: true });
            rmSync(dir, { recursive: true, force: true });
        }
    }, 120_000);
});
