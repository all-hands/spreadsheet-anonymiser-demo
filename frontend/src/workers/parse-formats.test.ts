// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('./wasm', async () => ({
    ...(await import('../lib/table/test-wasm')).realTableCodec(),
    ensureWasm: vi.fn(async () => {}),
}));

import { parseFile } from './parse';
import { generateFile } from './generate';
import { STREAM_THRESHOLD_BYTES } from '../lib/constants';

const withSize = (file: File, size: number): File => {
    Object.defineProperty(file, 'size', { value: size });
    return file;
};

describe('parseFile: text formats', () => {
    it('parses a small CSV in memory with a SHA-256 of the bytes and no streamed flag', async () => {
        const r = await parseFile(new File(['﻿id,name\r\n1,"A, B"\r\n'], 'a.csv'));
        expect(r.headers).toEqual(['id', 'name']);
        expect(r.data).toEqual([['1', 'A, B']]);
        expect(r.fileHash).toMatch(/^[0-9a-f]{64}$/);
        expect(r.streamed).toBeUndefined();
    });

    it('parses TSV (.tsv and .tab) and JSONL (.jsonl and .ndjson) like the CLI', async () => {
        for (const name of ['a.tsv', 'a.tab']) {
            const r = await parseFile(new File(['x\ty\n1\t"2\t3"\n'], name));
            expect(r.headers).toEqual(['x', 'y']);
            expect(r.data).toEqual([['1', '2\t3']]);
        }
        for (const name of ['a.jsonl', 'a.ndjson']) {
            const r = await parseFile(new File(['{"b":1.0,"a":null}\n{"b":2}\n'], name));
            expect(r.headers).toEqual(['a', 'b']);
            expect(r.data).toEqual([['', '1.0'], ['', '2']]);
        }
    });

    it('rejects an empty JSONL file but tolerates an empty CSV (existing behaviour)', async () => {
        await expect(parseFile(new File([''], 'a.jsonl'))).rejects.toThrow(/No JSON records/);
        expect((await parseFile(new File([''], 'a.csv'))).headers).toEqual([]);
    });

    it('above the threshold: previews the first rows, never reads the file whole', async () => {
        const lines = ['h1,h2'];
        for (let i = 0; i < 3000; i++) lines.push(`${i},v${i}`);
        const file = withSize(new File([lines.join('\n') + '\n'], 'big.csv'), STREAM_THRESHOLD_BYTES + 1);
        const whole = vi.spyOn(file, 'arrayBuffer');
        const r = await parseFile(file);
        expect(whole).not.toHaveBeenCalled();
        expect(r.streamed).toBe(true);
        expect(r.data).toHaveLength(1000);
        expect(r.headers).toEqual(['h1', 'h2']);
    });

    it('refuses text that is not UTF-8 instead of replacing bytes (as the CLI does)', async () => {
        const latin1 = new Uint8Array([...new TextEncoder().encode('a,b\n1,caf'), 0xe9, 0x0a]);
        await expect(parseFile(new File([latin1], 'a.csv'))).rejects.toThrow(/not valid UTF-8/);
        const big = withSize(new File([latin1], 'big.csv'), STREAM_THRESHOLD_BYTES + 1);
        await expect(parseFile(big)).rejects.toThrow(/not valid UTF-8/);
    });

    it('accepts a BOM before JSONL (the CLI does not) and strips it before CSV headers', async () => {
        const bom = '﻿';
        expect((await parseFile(new File([bom + '{"a":1}\n'], 'a.jsonl'))).data).toEqual([['1']]);
        expect((await parseFile(new File([bom + '"a,x",b\n1,2\n'], 'a.csv'))).headers).toEqual(['a,x', 'b']);
    });

    it('rejects ragged rows (the CLI always did; extra cells escaped every policy)', async () => {
        await expect(parseFile(new File(['a,b\n1,2,3\n'], 'a.csv'))).rejects.toThrow(/found 3 fields/);
        await expect(parseFile(new File(['a,b\n1\n'], 'a.csv'))).rejects.toThrow(/found 1 fields/);
    });

    it('an xlsx above the threshold is NOT streamed (still whole-file, 100 MiB cap)', async () => {
        const file = withSize(new File(['not a workbook'], 'x.xlsx'), STREAM_THRESHOLD_BYTES + 1);
        await expect(parseFile(file)).rejects.toThrow(/Excel parse failed/);
    });
});

describe('generateFile: text formats', () => {
    it('writes CLI-style bytes: \\n terminators, minimal quoting, no BOM', async () => {
        const csv = await generateFile(['a', 'b'], [['x,y', 1], [null, 'q"r']], 'csv');
        expect(csv.type).toBe('text/csv');
        expect(await csv.text()).toBe('a,b\n"x,y",1\n,"q""r"\n');
    });

    it('writes TSV and JSONL (sorted keys as given, string values)', async () => {
        expect(await (await generateFile(['a', 'b'], [['1', 'x\ty']], 'tsv')).text()).toBe('a\tb\n1\t"x\ty"\n');
        const jl = await generateFile(['a', 'b'], [['1', null]], 'jsonl');
        expect(await jl.text()).toBe('{"a":"1","b":""}\n');
        expect(jl.type).toBe('application/x-ndjson');
    });
});
