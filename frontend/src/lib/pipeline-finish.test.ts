import { describe, it, expect, beforeEach } from 'vitest';
import { finishDecryptRun, finishRun } from './pipeline';
import { PARSE, makeFile, blobText, makeWorker, makeDeps, installArtifactMocks } from '../test/pipeline-fakes';

let createdBlobs: ReturnType<typeof installArtifactMocks>['createdBlobs'];

beforeEach(() => {
    ({ createdBlobs } = installArtifactMocks());
});

describe('finishRun keyed per run', () => {
    it('records the policy as keyed-per-run in the audit log and its JSON, with no key material', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker, calls } = makeWorker(trace);
        const audit = makeDeps(trace, statuses, worker).audit;
        const { artifacts } = await finishRun(
            {
                file: makeFile('data.csv'),
                policies: { 0: { type: 'hash', keying: 'run' }, 1: { type: 'hash' }, 2: { type: 'mask' } },
            },
            { worker, audit, onStatus: (m) => statuses.push(m) },
            { headers: PARSE.headers, data: PARSE.data, metadata: PARSE.metadata }
        );

        expect(calls.anonymizePolicies?.[0]).toEqual({ type: 'hash', keying: 'run' });
        const entries = audit.getLog()?.entries ?? [];
        expect(entries[0]).toMatchObject({ columnName: 'name', operation: 'hash', keying: 'run' });
        expect(entries[1].keying).toBeUndefined();
        expect('keying' in entries[2]).toBe(false);

        const auditJson = await blobText(createdBlobs[artifacts.findIndex((a) => a.name === 'data_audit.json')]);
        const parsed = JSON.parse(auditJson) as { entries: Array<Record<string, unknown>> };
        expect(parsed.entries[0].keying).toBe('run');
        for (const e of parsed.entries) {
            expect(Object.keys(e).filter((k) => /key$|secret|salt/i.test(k) && k !== 'keying')).toEqual([]);
        }
    });
});

describe('finishRun', () => {
    it('runs the same tail on a dataset parsed at file-select (Advanced path)', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker, calls } = makeWorker(trace);
        const audit = makeDeps(trace, statuses, worker).audit;
        const file = makeFile('data.xlsx');
        const { artifacts } = await finishRun(
            {
                file,
                policies: { 1: { type: 'mask' } },
                dataset: 'd',
                tokenEncoding: 'hex',
                salt: null,
            },
            { worker, audit, onStatus: (m) => statuses.push(m) },
            {
                headers: PARSE.headers,
                data: PARSE.data,
                metadata: PARSE.metadata,
                fileHash: PARSE.fileHash,
            }
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
        expect(calls.anonymizePolicies).toEqual({ 1: { type: 'mask' } });
        expect(calls.generateType).toBe('xlsx');
        expect(calls.generateRows).toBe(PARSE.data);
        expect(artifacts.map((a) => a.name)).toEqual(['anonymized-data.xlsx', 'data_audit.json']);
        expect(audit.getLog()?.fileHash).toBe('deadbeef');
    });
});

describe('finishDecryptRun', () => {
    it('runs the decrypt tail — decrypt -> generate -> one artifact, no audit log', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker, calls } = makeWorker(trace);
        const audit = makeDeps(trace, statuses, worker).audit;
        const file = makeFile('data.xlsx');
        const { decrypted, artifacts } = await finishDecryptRun(
            { file, dataset: '  oncology  ' },
            { worker, audit, onStatus: (m) => statuses.push(m) },
            {
                headers: PARSE.headers,
                data: PARSE.data,
                metadata: PARSE.metadata,
                fileHash: PARSE.fileHash,
            }
        );

        expect(trace).toEqual(['decrypt', 'generate']);
        expect(calls.decryptOpts).toEqual({ dataset: 'oncology', tokenEncoding: undefined });
        expect(calls.decryptRows).toBe(PARSE.data);
        expect(calls.generateType).toBe('xlsx');
        expect(calls.generateRows).toBe(PARSE.data);
        expect(decrypted).toBe(2);
        expect(artifacts.map((a) => a.name)).toEqual(['decrypted-data.xlsx']);
        expect(audit.getLog()).toBeNull();
        expect(statuses).toContain('Generating file...');
    });

    it('rethrows a failure without touching the audit log', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker } = makeWorker(trace, { throwOn: 'decrypt' });
        const audit = makeDeps(trace, statuses, worker).audit;
        await expect(
            finishDecryptRun(
                { file: makeFile('data.csv') },
                { worker, audit, onStatus: (m) => statuses.push(m) },
                { headers: PARSE.headers, data: PARSE.data, metadata: PARSE.metadata }
            )
        ).rejects.toThrow('boom-decrypt');

        expect(trace).toEqual(['decrypt']);
        expect(audit.getLog()).toBeNull();
        expect(createdBlobs).toHaveLength(0);
    });

    it('a failed decrypt leaves the previous completed anonymise log completed', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const ok = makeWorker(trace);
        const audit = makeDeps(trace, statuses, ok.worker).audit;
        const parse = { headers: PARSE.headers, data: PARSE.data, metadata: PARSE.metadata, fileHash: PARSE.fileHash };
        await finishRun(
            { file: makeFile('data.csv'), policies: { 1: { type: 'mask' } }, dataset: 'd', tokenEncoding: 'hex', salt: null },
            { worker: ok.worker, audit, onStatus: (m) => statuses.push(m) },
            parse
        );
        const completed = audit.getLog();
        expect(completed?.status).toBe('completed');

        const bad = makeWorker(trace, { throwOn: 'decrypt' });
        await expect(
            finishDecryptRun(
                { file: makeFile('data.csv') },
                { worker: bad.worker, audit, onStatus: (m) => statuses.push(m) },
                parse
            )
        ).rejects.toThrow('boom-decrypt');

        expect(trace).not.toContain('failLog');
        expect(audit.getLog()).toEqual(completed);
    });
});
