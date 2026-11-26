// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./wasm', async () => ({
    ...(await import('../lib/table/test-wasm')).realTableCodec(),
    ensureWasm: vi.fn(async () => {}),
    generate_salt: vi.fn(() => new Uint8Array(32)),
    session_from_passphrase: vi.fn(() => ({
        column_key: (name: string) => new TextEncoder().encode(`key:${name}`),
        column_key_scoped: (ds: string, name: string) => new TextEncoder().encode(`key:${ds}/${name}`),
    })),
    policy_key_material: vi.fn((await import('../lib/table/test-wasm')).realKeyMaterial()),
    apply_policy: vi.fn((v: string, p: string) => (p === 'redact' ? '[REDACTED]' : `${p}(${v})`)),
    apply_policy_keyed_typed: vi.fn(
        (v: string, _p: string, key: Uint8Array) => `tok:${new TextDecoder().decode(key)}:${v}`
    ),
    apply_policy_legacy: vi.fn(),
    reencode_token_str: vi.fn((t: string) => t),
    is_encrypted_value: vi.fn(() => false),
    decrypt_any_value: vi.fn(),
}));

import { STREAM_CHUNK_ROWS, STREAM_SLICE_BYTES } from '../lib/constants';
import { anonymizeData } from './anonymize';
import { generateFile } from './generate';
import { parseTextInMemory, parseTextPreview } from './parse-text';
import { endSession, startSession } from './session';
import { cancelStream, readPreview, streamAnonymize } from './stream';
import type { WritableFileHandle } from './stream-io';
import type { ColumnPolicy } from '../types/policy';

const ROWS = 120_000;
const csvText = (rows = ROWS): string => {
    const lines = ['id,name,email,note'];
    for (let i = 0; i < rows; i++) {
        lines.push(`${i},Name ${i % 500},u${i % 700}@example.com,"line ${i}\nsecond, with comma"`);
    }
    return lines.join('\n') + '\n';
};

const policies: Record<number, ColumnPolicy> = { 1: { type: 'hash' }, 2: { type: 'hash' }, 3: { type: 'redact' } };
const noop = () => {};

beforeEach(async () => {
    endSession();
    await startSession('pw');
});

describe('streamAnonymize', () => {
    it('processes rows in bounded chunks and never reads more than one slice at a time', async () => {
        const file = new File([csvText()], 'big.csv');
        expect(file.size).toBeGreaterThan(2 * STREAM_SLICE_BYTES);

        const sliceSizes: number[] = [];
        const origSlice = file.slice.bind(file);
        file.slice = ((s?: number, e?: number, t?: string) => {
            sliceSizes.push((e ?? file.size) - (s ?? 0));
            return origSlice(s, e, t);
        }) as typeof file.slice;

        const chunkSizes: number[] = [];
        const res = await streamAnonymize(file, policies, {}, null, noop, (n) => chunkSizes.push(n));

        expect(res.totalRows).toBe(ROWS);
        expect(chunkSizes.reduce((a, b) => a + b, 0)).toBe(ROWS);
        expect(Math.max(...chunkSizes)).toBeLessThanOrEqual(STREAM_CHUNK_ROWS);
        expect(chunkSizes.length).toBeGreaterThanOrEqual(ROWS / STREAM_CHUNK_ROWS);
        expect(Math.max(...sliceSizes)).toBeLessThanOrEqual(STREAM_SLICE_BYTES);
        expect(sliceSizes.length).toBeGreaterThan(1);
        expect(res.counts).toEqual({ 1: ROWS, 2: ROWS, 3: ROWS });
    });

    it('produces byte-identical output to the in-memory path (same tokens for same values)', async () => {
        const text = csvText(30_000);
        const file = new File([text], 'data.csv');

        const parsed = await parseTextInMemory(file, 'csv', noop);
        const mem = await anonymizeData(parsed.data, parsed.headers, parsed.metadata, policies, noop, {});
        const inMemory = await (await generateFile(parsed.headers, mem.data, 'csv')).text();

        const streamed = await streamAnonymize(file, policies, {}, null, noop);
        const out = await streamed.blob!.text();

        expect(out).toBe(inMemory);
        expect(streamed.counts).toEqual(mem.counts);
        const lines = out.split('\n');
        const tokenOf = (line: string) => line.split(',')[1];
        expect(tokenOf(lines[1])).toBe(tokenOf(lines[1 + 500]));
        expect(tokenOf(lines[1 + 25_000])).toBe(tokenOf(lines[1]));
    });

    it('hashes the file bytes as they stream (SHA-256 of the original)', async () => {
        const file = new File([csvText(5000)], 'h.csv');
        const want = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        expect((await streamAnonymize(file, policies, {}, null, noop)).fileHash).toBe(want);
    });

    it('writes incrementally into a file handle and returns no blob', async () => {
        const written: string[] = [];
        let closed = false;
        const handle: WritableFileHandle = {
            createWritable: async () => ({
                write: async (d: Uint8Array) => void written.push(new TextDecoder().decode(d)),
                close: async () => void (closed = true),
                abort: async () => {},
            }),
        };
        const file = new File([csvText(12_000)], 'h.csv');
        const res = await streamAnonymize(file, policies, {}, handle, noop);
        expect(res.blob).toBeNull();
        expect(closed).toBe(true);
        expect(written.length).toBeGreaterThan(3);
        expect(written[0]).toBe('id,name,email,note\n');
        expect(written.join('').split('\n').length).toBeGreaterThan(12_000);
    });

    it('reports byte progress up to the file size', async () => {
        const file = new File([csvText(5000)], 'p.csv');
        const seen: number[] = [];
        await streamAnonymize(file, policies, {}, null, (p) => {
            expect(p.total).toBe(file.size);
            seen.push(p.bytes);
        });
        expect(seen.at(-1)).toBe(file.size);
        expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    });

    it('cancels at the next slice boundary and aborts the sink', async () => {
        let aborted = false;
        const handle: WritableFileHandle = {
            createWritable: async () => ({
                write: async () => {},
                close: async () => {},
                abort: async () => void (aborted = true),
            }),
        };
        const file = new File([csvText()], 'c.csv');
        const run = streamAnonymize(file, policies, {}, handle, () => cancelStream());
        await expect(run).rejects.toThrow('Cancelled.');
        expect(aborted).toBe(true);
    });

    it('streams TSV and JSONL too and refuses a spreadsheet', async () => {
        const tsv = await streamAnonymize(new File(['a\tb\n1\tx\n'], 'a.tsv'), { 1: { type: 'redact' } }, {}, null, noop);
        expect(await tsv.blob!.text()).toBe('a\tb\n1\t[REDACTED]\n');
        const jl = await streamAnonymize(new File(['{"b":"x","a":1}\n'], 'a.jsonl'), { 1: { type: 'redact' } }, {}, null, noop);
        expect(await jl.blob!.text()).toBe('{"a":"1","b":"[REDACTED]"}\n');
        await expect(streamAnonymize(new File(['x'], 'a.xlsx'), {}, {}, null, noop)).rejects.toThrow(/Spreadsheets/);
    });

    it('fails on a file with no rows', async () => {
        await expect(streamAnonymize(new File([''], 'e.csv'), {}, {}, null, noop)).rejects.toThrow(/No rows/);
    });
});

describe('preview (files above the in-memory threshold)', () => {
    it('reads only the first rows and marks the parse as streamed', async () => {
        const file = new File([csvText()], 'big.csv');
        const origSlice = file.slice.bind(file);
        let slices = 0;
        file.slice = ((s?: number, e?: number, t?: string) => {
            slices++;
            return origSlice(s, e, t);
        }) as typeof file.slice;

        const parsed = await parseTextPreview(file, 'csv', noop);
        expect(parsed.streamed).toBe(true);
        expect(parsed.data).toHaveLength(1000);
        expect(parsed.headers).toEqual(['id', 'name', 'email', 'note']);
        expect(parsed.fileHash).toBe('');
        expect(slices).toBe(1);
        expect((await readPreview(file, 'csv', 10)).rows).toHaveLength(10);
    });
});

describe('streamAnonymize pins the session at the start of the run', () => {
    const collect = (onFirstBody: () => void) => {
        const written: string[] = [];
        let n = 0;
        const handle: WritableFileHandle = {
            createWritable: async () => ({
                write: async (d: Uint8Array) => {
                    written.push(new TextDecoder().decode(d));
                    if (++n === 2) onFirstBody();
                },
                close: async () => {},
                abort: async () => {},
            }),
        };
        return { handle, written };
    };
    const rows = STREAM_CHUNK_ROWS * 3 + 5;

    it('keeps keying every batch after the session ends mid-run', async () => {
        const file = new File([csvText(rows)], 'k.csv');
        const parsed = await parseTextInMemory(file, 'csv', noop);
        const mem = await anonymizeData(parsed.data, parsed.headers, parsed.metadata, policies, noop, {});
        const want = await (await generateFile(parsed.headers, mem.data, 'csv')).text();

        const { handle, written } = collect(() => endSession());
        await streamAnonymize(file, policies, {}, handle, noop);
        const out = written.join('');
        expect(out).toBe(want);
        expect(out).not.toMatch(/\b[0-9a-f]{64}\b/);
        expect(out).toContain('tok:key:name:');
    });

    it('does not pick up a session started mid-run', async () => {
        endSession();
        const file = new File([csvText(rows)], 'u.csv');
        const parsed = await parseTextInMemory(file, 'csv', noop);
        const mem = await anonymizeData(parsed.data, parsed.headers, parsed.metadata, policies, noop, {});
        const want = await (await generateFile(parsed.headers, mem.data, 'csv')).text();

        const { handle, written } = collect(() => void startSession('pw'));
        await streamAnonymize(file, policies, {}, handle, noop);
        expect(written.join('')).toBe(want);
        expect(want).not.toContain('tok:');
    });
});
