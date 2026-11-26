// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import Papa from 'papaparse';

vi.mock('./wasm', async () => ({
    ...(await import('../lib/table/test-wasm')).realTableCodec(),
    ensureWasm: vi.fn(async () => {}),
}));
import { generateFile } from './generate';

describe('generateFile', () => {
    it('round-trips headers and rows through CSV, escaping included', async () => {
        const headers = ['name', 'note', 'quoted'];
        const data = [
            ['Ann, Jr', 'line\nbreak', 'say "hi"'],
            ['Bo', '', 'plain'],
        ];

        const blob = await generateFile(headers, data, 'csv');

        expect(blob.type).toBe('text/csv');
        const text = await blob.text();
        const reparsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
        expect(reparsed.errors).toEqual([]);
        expect(reparsed.data).toEqual([headers, ...data]);
    });
});
