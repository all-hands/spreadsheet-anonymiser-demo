import { describe, it, expect } from 'vitest';
import { fileProblem, parseProblem } from './file-validation';
import { shouldStream, tableFormatOf } from './table-format';
import { MAX_FILE_BYTES, MAX_STREAM_FILE_BYTES, STREAM_THRESHOLD_BYTES } from './constants';

describe('fileProblem', () => {
    it('accepts every supported extension at or under its cap, any case', () => {
        expect(fileProblem({ name: 'a.csv', size: 10 })).toBeNull();
        expect(fileProblem({ name: 'A.XLSX', size: MAX_FILE_BYTES })).toBeNull();
        expect(fileProblem({ name: 'A.ODS', size: MAX_FILE_BYTES })).toBeNull();
        for (const ext of ['.tsv', '.tab', '.jsonl', '.ndjson']) {
            expect(fileProblem({ name: `a${ext}`, size: 10 })).toBeNull();
        }
    });

    it('caps .xlsx and .ods at 100 MiB and streamed text formats at 2 GiB', () => {
        expect(MAX_FILE_BYTES).toBe(100 * 1024 * 1024);
        expect(MAX_STREAM_FILE_BYTES).toBe(2 * 1024 * 1024 * 1024);
        expect(fileProblem({ name: 'big.csv', size: 500 * 1024 * 1024 })).toBeNull();
        expect(fileProblem({ name: 'big.jsonl', size: MAX_STREAM_FILE_BYTES })).toBeNull();
        expect(fileProblem({ name: 'big.xlsx', size: 500 * 1024 * 1024 })).not.toBeNull();
        expect(fileProblem({ name: 'big.ods', size: MAX_FILE_BYTES + 1 })).toMatch(/100 MB/);
    });

    it('rejects an oversize xlsx naming the limit and the CLI', () => {
        const msg = fileProblem({ name: 'big.xlsx', size: MAX_FILE_BYTES + 1 });
        expect(msg).toMatch(/100 MB/);
        expect(msg).toMatch(/anonymiser-cli/);
        expect(msg).toMatch(/larger files/);
    });

    it('rejects a text file over the streaming cap naming 2 GB and the CLI', () => {
        const msg = fileProblem({ name: 'huge.tsv', size: MAX_STREAM_FILE_BYTES + 1 });
        expect(msg).toMatch(/2 GB/);
        expect(msg).toMatch(/anonymiser-cli/);
    });

    it('rejects unsupported formats listing the supported ones', () => {
        expect(fileProblem({ name: 'data.json', size: 1 })).toMatch(
            /Unsupported file format ".json".*\.csv, \.tsv, \.jsonl, \.xlsx and \.ods/
        );
        expect(fileProblem({ name: 'noext', size: 1 })).toMatch(/Unsupported file format\./);
    });
});

describe('tableFormatOf / shouldStream (CLI infer_format parity)', () => {
    it('maps extensions the way the CLI does', () => {
        expect(tableFormatOf('a.csv')).toBe('csv');
        expect(tableFormatOf('a.TSV')).toBe('tsv');
        expect(tableFormatOf('a.tab')).toBe('tsv');
        expect(tableFormatOf('a.jsonl')).toBe('jsonl');
        expect(tableFormatOf('a.ndjson')).toBe('jsonl');
        expect(tableFormatOf('a.xlsx')).toBe('xlsx');
        expect(tableFormatOf('a.ODS')).toBe('ods');
    });

    it('streams only text formats above the in-memory threshold', () => {
        expect(shouldStream({ name: 'a.csv', size: STREAM_THRESHOLD_BYTES })).toBe(false);
        expect(shouldStream({ name: 'a.csv', size: STREAM_THRESHOLD_BYTES + 1 })).toBe(true);
        expect(shouldStream({ name: 'a.jsonl', size: STREAM_THRESHOLD_BYTES + 1 })).toBe(true);
        expect(shouldStream({ name: 'a.xlsx', size: STREAM_THRESHOLD_BYTES + 1 })).toBe(false);
        expect(shouldStream({ name: 'a.ods', size: STREAM_THRESHOLD_BYTES + 1 })).toBe(false);
    });
});

describe('parseProblem', () => {
    it('refuses a table with no columns as empty', () => {
        expect(parseProblem({ headers: [], data: [] })).toMatch(/is empty/);
    });
    it('refuses a header-only table', () => {
        expect(parseProblem({ headers: ['a', 'b'], data: [] })).toMatch(/no data rows/);
    });
    it('accepts a table with at least one row', () => {
        expect(parseProblem({ headers: ['a'], data: [['1']] })).toBeNull();
    });
});
