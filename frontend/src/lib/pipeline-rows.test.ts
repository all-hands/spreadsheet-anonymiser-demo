import { describe, it, expect, beforeEach } from 'vitest';
import { finishDecryptRun, finishRun, filterRows } from './pipeline';
import { PARSE, makeFile, makeWorker, makeDeps, installArtifactMocks } from '../test/pipeline-fakes';

beforeEach(() => {
    installArtifactMocks();
});

describe('filterRows', () => {
    it('passes the very same object through when nothing is excluded', () => {
        expect(filterRows(PARSE)).toBe(PARSE);
        expect(filterRows(PARSE, new Set())).toBe(PARSE);
    });

    it('drops exactly the excluded indices, keeping order', () => {
        const filtered = filterRows(PARSE, new Set([1]));
        expect(filtered.data).toEqual([PARSE.data[0]]);
        const firstDropped = filterRows(PARSE, new Set([0]));
        expect(firstDropped.data).toEqual([PARSE.data[1]]);
    });

    it('keeps headers, metadata and fileHash untouched', () => {
        const filtered = filterRows(PARSE, new Set([0, 1]));
        expect(filtered.headers).toBe(PARSE.headers);
        expect(filtered.metadata).toBe(PARSE.metadata);
        expect(filtered.fileHash).toBe(PARSE.fileHash);
    });
});

describe('finishRun with excludedRows', () => {
    it('drops excluded rows from the export but logs the ORIGINAL totalRows', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker, calls } = makeWorker(trace);
        const audit = makeDeps(trace, statuses, worker).audit;

        const { artifacts } = await finishRun(
            { file: makeFile('data.csv'), policies: { 1: { type: 'mask' } }, excludedRows: new Set([1]) },
            { worker, audit, onStatus: (m) => statuses.push(m) },
            PARSE
        );

        expect(calls.anonymizeRows).toEqual([PARSE.data[0]]);
        expect(calls.generateRows).toEqual([PARSE.data[0]]);
        expect(audit.getLog()?.totalRows).toBe(2);
        expect(statuses).toContain('Excluding 1 of 2 rows.');
        expect(artifacts.map((a) => a.name)).toEqual(['anonymized-data.csv', 'data_audit.json']);
    });

    it('completes on empty kept-data (all rows excluded) — header-only export', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker, calls } = makeWorker(trace);
        const audit = makeDeps(trace, statuses, worker).audit;

        const { artifacts } = await finishRun(
            { file: makeFile('data.csv'), policies: { 1: { type: 'mask' } }, excludedRows: new Set([0, 1]) },
            { worker, audit, onStatus: (m) => statuses.push(m) },
            PARSE
        );

        expect(calls.anonymizeRows).toEqual([]);
        expect(calls.generateRows).toEqual([]);
        expect(audit.getLog()?.totalRows).toBe(2);
        expect(statuses).toContain('Excluding 2 of 2 rows.');
        expect(artifacts.map((a) => a.name)).toEqual(['anonymized-data.csv', 'data_audit.json']);
    });

    it('without exclusions behaves exactly as before', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker, calls } = makeWorker(trace);
        const audit = makeDeps(trace, statuses, worker).audit;

        await finishRun(
            { file: makeFile('data.xlsx'), policies: { 1: { type: 'mask' } } },
            { worker, audit, onStatus: (m) => statuses.push(m) },
            PARSE
        );

        expect(trace).toEqual([
            'startNewLog',
            'anonymize',
            'addEntry',
            'addEntry',
            'addEntry',
            'generate',
            'completeLog',
        ]);
        expect(calls.anonymizeRows).toBe(PARSE.data);
        expect(calls.generateRows).toBe(PARSE.data);
        expect(statuses.every((s) => !s.startsWith('Excluding'))).toBe(true);
    });
});

describe('finishDecryptRun with excludedRows', () => {
    it('drops the same rows as the anonymise tail and reports symmetrically', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker, calls } = makeWorker(trace);
        const audit = makeDeps(trace, statuses, worker).audit;

        const { artifacts } = await finishDecryptRun(
            { file: makeFile('data.xlsx'), dataset: 'd', excludedRows: new Set([1]) },
            { worker, audit, onStatus: (m) => statuses.push(m) },
            PARSE
        );

        expect(calls.decryptRows).toEqual([PARSE.data[0]]);
        expect(calls.generateRows).toEqual([PARSE.data[0]]);
        expect(statuses).toContain('Excluding 1 of 2 rows.');
        expect(trace).toEqual(['decrypt', 'generate']);
        expect(artifacts.map((a) => a.name)).toEqual(['decrypted-data.xlsx']);
        expect(audit.getLog()).toBeNull();
    });

    it('completes on empty kept-data (all rows excluded) — header-only export', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker, calls } = makeWorker(trace);
        const audit = makeDeps(trace, statuses, worker).audit;

        const { artifacts } = await finishDecryptRun(
            { file: makeFile('data.csv'), excludedRows: new Set([0, 1]) },
            { worker, audit, onStatus: (m) => statuses.push(m) },
            PARSE
        );

        expect(calls.decryptRows).toEqual([]);
        expect(calls.generateRows).toEqual([]);
        expect(statuses).toContain('Excluding 2 of 2 rows.');
        expect(artifacts.map((a) => a.name)).toEqual(['decrypted-data.csv']);
        expect(audit.getLog()).toBeNull();
    });

    it('without exclusions behaves exactly as before', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker, calls } = makeWorker(trace);
        const audit = makeDeps(trace, statuses, worker).audit;

        await finishDecryptRun(
            { file: makeFile('data.xlsx') },
            { worker, audit, onStatus: (m) => statuses.push(m) },
            PARSE
        );

        expect(trace).toEqual(['decrypt', 'generate']);
        expect(calls.decryptRows).toBe(PARSE.data);
        expect(calls.generateRows).toBe(PARSE.data);
        expect(statuses.every((s) => !s.startsWith('Excluding'))).toBe(true);
    });
});
