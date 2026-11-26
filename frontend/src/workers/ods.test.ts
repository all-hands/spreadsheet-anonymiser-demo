// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./wasm', () => ({ ensureWasm: vi.fn(async () => {}) }));

import { generateFile } from './generate';
import { ODS_MIME, normaliseContent } from './ods';
import { parseFile } from './parse';
import { SAMPLES } from '../lib/samples';
import type { Rows } from '../types/data';

const fixture = (name: string): File =>
    new File([readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)) as BlobPart], name);
const zipFile = (parts: Record<string, string>): File =>
    new File([zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)]))) as BlobPart], 'x.ods');
const manifest = (inner: string) => `<manifest:manifest xmlns:manifest="m">${inner}</manifest:manifest>`;
const hasUv = spawnSync('uv', ['--version']).status === 0;

describe('parseFile: .ods', () => {
    it('reads one value per cell type, from the first sheet only', async () => {
        const { headers, data } = await parseFile(fixture('types.ods'));
        expect(headers).toHaveLength(16);
        expect(data).toHaveLength(1);
        const row = Object.fromEntries(headers.map((h, i) => [h, data[0][i]]));
        expect(row).toEqual({
            text: 'Zoë 日本語',
            number: 3.14,
            bool: true,
            date: '2024-03-15T00:00:00.000Z',
            datetime: '2024-03-15T13:45:30.500Z',
            time: '1899-12-30T13:45:30.000Z',
            long_time: '1899-12-31T12:00:00.000Z',
            percent: 0.256,
            money: 1234.5,
            rich: 'plain bold link',
            spaces: '  padded\t ',
            multiline: 'line1\nline2\nline3',
            duration_text: 'PT1H',
            gap: null,
            formula: 6.28,
            note: 'shown',
        });
    });

    it('keeps repeated header rows and grouped rows, in order', async () => {
        const { headers, data } = await parseFile(fixture('grouped.ods'));
        expect(headers).toEqual(['name', 'city']);
        expect(data.map((r) => Array.from(r))).toEqual([
            ['Alice', 'Leeds'],
            ['Bob', 'York'],
            ['Bob', 'York'],
            ['Cy', 'Bath'],
            ['merged'],
            ['<table:table-rows>', null, null, 'far'],
        ]);
    });

    it('treats an empty first sheet and a blank first row like .xlsx does', async () => {
        for (const name of ['empty-first-sheet', 'blank-first-row']) {
            const ods = await parseFile(fixture(`${name}.ods`));
            const xlsx = await parseFile(fixture(`${name}.xlsx`));
            expect(ods.headers).toEqual(xlsx.headers);
        }
        expect((await parseFile(fixture('blank-first-row.ods'))).data).toEqual([['a', 'b']]);
    });

    it('reads the demo file', async () => {
        const sample = SAMPLES.find((s) => s.format === 'ods')!;
        const bytes = readFileSync(new URL(`../../public${sample.path}`, import.meta.url));
        const { headers, data } = await parseFile(new File([bytes as BlobPart], 'volunteers.ods'));
        expect(headers).toContain('email');
        expect(data).toHaveLength(30);
    });

    it('refuses a file that is not a readable .ods', async () => {
        await expect(parseFile(new File(['name,x\n'], 'a.ods'))).rejects.toThrow(/ODS parse failed/);
        await expect(parseFile(zipFile({ mimetype: 'application/vnd.oasis.opendocument.text' }))).rejects.toThrow(
            /not an OpenDocument spreadsheet/
        );
        await expect(parseFile(zipFile({ mimetype: ODS_MIME }))).rejects.toThrow(/missing content\.xml/);
        const truncated = new Uint8Array(await fixture('types.ods').arrayBuffer()).slice(0, 900);
        await expect(parseFile(new File([truncated], 'a.ods'))).rejects.toThrow(/ODS parse failed/);
    });

    it('says so when the file is password-protected', async () => {
        const file = zipFile({
            mimetype: ODS_MIME,
            'content.xml': 'ciphertext',
            'META-INF/manifest.xml': manifest('<manifest:encryption-data manifest:checksum="x"/>'),
        });
        await expect(parseFile(file)).rejects.toThrow(/password-protected/);
    });

    it('refuses an entry that declares more than the decompression cap', async () => {
        const bytes = new Uint8Array(await zipFile({ mimetype: ODS_MIME, 'content.xml': '<a/>' }).arrayBuffer());
        const view = new DataView(bytes.buffer);
        for (let i = 0; i + 46 < bytes.length; i++) {
            if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 0x7fffffff, true);
        }
        await expect(parseFile(new File([bytes], 'a.ods'))).rejects.toThrow(/too large/);
    });

    it('refuses a sheet whose repeats add up to too many cells', async () => {
        const ns = ['office', 'table', 'text'].map((n) => `xmlns:${n}="urn:${n}"`).join(' ');
        const cell = '<table:table-cell office:value-type="string" table:number-columns-repeated="1000"><text:p>x</text:p></table:table-cell>';
        const file = zipFile({
            mimetype: ODS_MIME,
            'content.xml': `<office:document-content ${ns}><office:body><office:spreadsheet><table:table table:name="A"><table:table-row table:number-rows-repeated="1000000">${cell}</table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`,
        });
        await expect(parseFile(file)).rejects.toThrow(/ODS parse failed.*limit/);
    });
});

describe('normaliseContent', () => {
    it('leaves comments and CDATA alone and is not confused by > in an attribute', () => {
        const keep = '<!-- <table:table-rows> --><t><![CDATA[<table:table-rows>]]></t>';
        expect(normaliseContent(keep)).toBe(keep);
        expect(
            normaliseContent('<table:table-cell table:formula="a>b" office:value-type="time" office:time-value="-PT1H">')
        ).toBe('<table:table-cell table:formula="a>b" office:value-type="date" office:date-value="1899-12-29T23:00:00.000Z">');
    });
});

describe('generateFile: .ods', () => {
    const headers = ['name', 'n', 'flag', 'note'];
    const data: Rows = [
        ['Ann', 1, true, null],
        ['Bo, "Q"', 2.5, false, ''],
        ['=1+1', 0, true, 'of:=1'],
        ['0123', -7, false, '1e5'],
        ['  lead  two ', 1e21, true, 'a\nb\tc'],
        ['😀 日本語', 12345678901234, false, '<&> $&'],
        ['#N/A', 3, true, '2024-01-01T00:00:00.000Z'],
    ];

    it('round-trips through parseFile', async () => {
        const blob = await generateFile(headers, data, 'ods');
        expect(blob.type).toBe(ODS_MIME);
        const r = await parseFile(new File([blob], 'out.ods'));
        expect(r.headers).toEqual(headers);
        expect(r.data.map((row) => Array.from(row))).toEqual([['Ann', 1, true], ...data.slice(1)]);
    });

    it('starts with an uncompressed mimetype entry', async () => {
        const head = new Uint8Array(await (await generateFile(headers, [], 'ods')).slice(0, 100).arrayBuffer());
        expect(new TextDecoder().decode(head.slice(30, 38))).toBe('mimetype');
        expect(head[8]).toBe(0);
        expect(new TextDecoder().decode(head)).toContain(ODS_MIME);
    });

    it.skipIf(!hasUv)('is read back by odfpy: values, types and white space', async () => {
        const blob = await generateFile(headers, data, 'ods');
        const script = fileURLToPath(new URL('./__fixtures__/read_back_ods.py', import.meta.url));
        const run = spawnSync('uv', ['run', '--no-project', '--with', 'odfpy', 'python', '-I', script], {
            encoding: 'utf8',
            input: new Uint8Array(await blob.arrayBuffer()),
        });
        expect(run.status, run.stderr).toBe(0);
        const out = JSON.parse(run.stdout) as { sheets: string[]; rows: [string, unknown][][] };
        expect(out.sheets).toEqual(['Anonymized']);
        expect(out.rows[0].map((c) => c[1])).toEqual(headers);
        expect(out.rows[1].slice(0, 3)).toEqual([['string', 'Ann'], ['float', 1], ['boolean', 'true']]);
        expect(out.rows[3][0]).toEqual(['string', '=1+1']);
        expect(out.rows[4][0]).toEqual(['string', '0123']);
        expect(out.rows[5][0]).toEqual(['string', '  lead  two ']);
        expect(out.rows[5][3]).toEqual(['string', 'a\nb\tc']);
        expect(out.rows[6][3]).toEqual(['string', '<&> $&']);
        expect(out.rows[7][0]).toEqual(['string', '#N/A']);
    }, 60_000);
});
