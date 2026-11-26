import { describe, it, expect, beforeEach } from 'vitest';
import { runPipeline, defaultPolicies, finishRun, finishDecryptRun } from './pipeline';
import { KEYED_SESSION_REQUIRED } from '../types/policy';
import type { ColumnPolicy } from '../types/policy';
import type { AuditLog } from '../types/audit';
import { useAuditStore } from '../store/auditStore';
import {
    PARSE,
    makeFile,
    blobText,
    makeWorker,
    makeDeps,
    installArtifactMocks,
} from '../test/pipeline-fakes';

let createdBlobs: Blob[];
let clickMock: ReturnType<typeof installArtifactMocks>['clickMock'];

beforeEach(() => {
    ({ createdBlobs, clickMock } = installArtifactMocks());
});

describe('defaultPolicies', () => {
    it('masks every non-text column and leaves text columns out', () => {
        expect(defaultPolicies(PARSE.metadata)).toEqual({
            1: { type: 'mask' },
            2: { type: 'mask' },
        });
    });
});

describe('runPipeline', () => {
    it('selects the shared default policies (sensitive non-text -> mask)', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker, calls } = makeWorker(trace);
        const { parse, counts } = await runPipeline(
            { file: makeFile('data.csv') },
            makeDeps(trace, statuses, worker)
        );

        expect(calls.anonymizePolicies).toEqual({ 1: { type: 'mask' }, 2: { type: 'mask' } });
        expect(statuses).toContain('Found 2 sensitive columns. Anonymising...');
        expect(parse).toBe(PARSE);
        expect(counts).toEqual({ 1: 2, 2: 2 });
    });

    it('writes one audit entry per column with the real transformed counts', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker } = makeWorker(trace, { counts: { 1: 1, 2: 2 } });
        const audit = makeDeps(trace, statuses, worker).audit;
        const file = makeFile('data.csv');
        await runPipeline({ file }, { worker, audit, onStatus: (m) => statuses.push(m) });

        expect(trace.slice(0, 6)).toEqual([
            'parse',
            'startNewLog',
            'anonymize',
            'addEntry',
            'addEntry',
            'addEntry',
        ]);
        const log = audit.getLog();
        expect(log?.filename).toBe('data.csv');
        expect(log?.fileSize).toBe(file.size);
        expect(log?.totalRows).toBe(2);
        expect(log?.totalColumns).toBe(3);
        expect(log?.fileHash).toBe('deadbeef');
        expect(log?.entries.map((e) => [e.columnIndex, e.operation, e.rowsAffected])).toEqual([
            [0, 'keep', 0],
            [1, 'mask', 1],
            [2, 'mask', 2],
        ]);
    });

    it('completes the log only after the output file exists', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker } = makeWorker(trace);
        await runPipeline({ file: makeFile('data.csv') }, makeDeps(trace, statuses, worker));

        expect(trace).toEqual([
            'parse',
            'startNewLog',
            'anonymize',
            'addEntry',
            'addEntry',
            'addEntry',
            'generate',
            'completeLog',
        ]);
    });

    it('failLogs when the worker throws during anonymize', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker } = makeWorker(trace, { throwOn: 'anonymize' });
        const audit = makeDeps(trace, statuses, worker).audit;
        await expect(
            runPipeline(
                { file: makeFile('data.csv') },
                { worker, audit, onStatus: (m) => statuses.push(m) }
            )
        ).rejects.toThrow('boom-anonymize');

        expect(trace).toEqual(['parse', 'startNewLog', 'anonymize', 'failLog']);
        expect(audit.getLog()?.status).toBe('failed');
        expect(audit.getLog()?.errorMessage).toBe('boom-anonymize');
        expect(createdBlobs).toHaveLength(0);
        expect(clickMock).not.toHaveBeenCalled();
    });

    it('failLogs (not completeLog) when generating the file fails', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker } = makeWorker(trace, { throwOn: 'generate' });
        const audit = makeDeps(trace, statuses, worker).audit;
        await expect(
            runPipeline(
                { file: makeFile('data.csv') },
                { worker, audit, onStatus: (m) => statuses.push(m) }
            )
        ).rejects.toThrow('boom-generate');

        expect(trace).toEqual([
            'parse',
            'startNewLog',
            'anonymize',
            'addEntry',
            'addEntry',
            'addEntry',
            'generate',
            'failLog',
        ]);
        expect(audit.getLog()?.status).toBe('failed');
        expect(audit.getLog()?.errorMessage).toBe('boom-generate');
        expect(createdBlobs).toHaveLength(0);
    });

    it('auto-downloads only the main output; salt and audit JSON are link-only', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker } = makeWorker(trace);
        const salt = new Uint8Array([1, 2, 3]);
        const { artifacts } = await runPipeline(
            { file: makeFile('data.csv'), salt },
            makeDeps(trace, statuses, worker)
        );

        expect(artifacts.map((a) => a.name)).toEqual([
            'anonymized-data.csv',
            'anonymized-data.csv.salt',
            'data_audit.json',
        ]);
        expect(clickMock).toHaveBeenCalledTimes(1);
        expect(createdBlobs).toHaveLength(3);
        expect(createdBlobs[0].type).toBe('text/csv');
        expect(createdBlobs[1].type).toBe('');
        expect(createdBlobs[1].size).toBe(3);

        const auditJson = JSON.parse(await blobText(createdBlobs[2])) as AuditLog;
        expect(auditJson.status).toBe('completed');
        expect(auditJson.completedAt).toBeDefined();
        expect(auditJson.entries).toHaveLength(3);
    });

    it('sniffs the output format from the file extension', async () => {
        const traceCsv: string[] = [];
        const { worker: wCsv, calls: cCsv } = makeWorker(traceCsv);
        await runPipeline({ file: makeFile('data.csv') }, makeDeps(traceCsv, [], wCsv));
        expect(cCsv.generateType).toBe('csv');

        const traceXlsx: string[] = [];
        const { worker: wXlsx, calls: cXlsx } = makeWorker(traceXlsx);
        await runPipeline({ file: makeFile('data.xlsx') }, makeDeps(traceXlsx, [], wXlsx));
        expect(cXlsx.generateType).toBe('xlsx');
        expect(traceXlsx[0]).toBe('parse');
    });

    it('forwards trimmed dataset and token encoding as run options', async () => {
        const trace: string[] = [];
        const { worker, calls } = makeWorker(trace);
        await runPipeline(
            { file: makeFile('data.csv'), dataset: '  oncology  ', tokenEncoding: 'base32' },
            makeDeps(trace, [], worker)
        );
        expect(calls.anonymizeOpts).toEqual({ dataset: 'oncology', tokenEncoding: 'base32' });

        const traceSimple: string[] = [];
        const { worker: wSimple, calls: cSimple } = makeWorker(traceSimple);
        await runPipeline({ file: makeFile('data.csv') }, makeDeps(traceSimple, [], wSimple));
        expect(cSimple.anonymizeOpts).toEqual({ dataset: undefined, tokenEncoding: undefined });
    });

    it('uses provided policies as-is and skips the default message', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        const { worker, calls } = makeWorker(trace);
        const provided: Record<number, ColumnPolicy> = { 0: { type: 'hash' } };
        await runPipeline(
            { file: makeFile('data.csv'), policies: provided },
            makeDeps(trace, statuses, worker)
        );

        expect(calls.anonymizePolicies).toBe(provided);
        expect(statuses.some((s) => s.startsWith('Found '))).toBe(false);
    });
});

describe('runPipeline against the real audit store', () => {
    beforeEach(() => {
        useAuditStore.setState({ currentLog: null });
    });

    it('serializes THIS run\'s completed log — the sink read is live, not a pre-run snapshot', async () => {
        const { worker: w1 } = makeWorker([]);
        await runPipeline(
            { file: makeFile('first.csv') },
            { worker: w1, audit: useAuditStore.getState(), onStatus: () => {} }
        );
        const first = JSON.parse(await blobText(createdBlobs[1])) as AuditLog;
        expect(first.filename).toBe('first.csv');
        expect(first.status).toBe('completed');

        const { worker: w2 } = makeWorker([]);
        await runPipeline(
            { file: makeFile('second.csv') },
            { worker: w2, audit: useAuditStore.getState(), onStatus: () => {} }
        );
        const second = JSON.parse(await blobText(createdBlobs[3])) as AuditLog;
        expect(second.filename).toBe('second.csv');
        expect(second.status).toBe('completed');
    });
});

describe('keyed-session and settle guards', () => {
    it('refuses Encrypt without a session before starting any log or worker call', async () => {
        const trace: string[] = [];
        const { worker } = makeWorker(trace);
        await expect(
            finishRun(
                { file: makeFile('data.csv'), policies: { 0: { type: 'encrypt' } }, salt: null },
                makeDeps(trace, [], worker),
                PARSE
            )
        ).rejects.toThrow(KEYED_SESSION_REQUIRED);
        expect(trace).toEqual([]);
    });

    it('allows Encrypt when a session salt exists', async () => {
        const trace: string[] = [];
        const { worker } = makeWorker(trace);
        await finishRun(
            { file: makeFile('data.csv'), policies: { 0: { type: 'encrypt' } }, salt: new Uint8Array(32) },
            makeDeps(trace, [], worker),
            PARSE
        );
        expect(trace).toContain('anonymize');
    });

    it('drops progress that arrives after a failed run settled', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        let late: ((m: string) => void) | undefined;
        const { worker } = makeWorker(trace);
        worker.anonymizeData = async (_d, _h, _m, _p, onProgress) => {
            late = onProgress;
            throw new Error('boom');
        };
        await expect(
            finishRun({ file: makeFile('d.csv'), policies: { 1: { type: 'mask' } } }, makeDeps(trace, statuses, worker), PARSE)
        ).rejects.toThrow('boom');
        const before = [...statuses];
        late?.('Anonymising row 0/60');
        expect(statuses).toEqual(before);
    });

    it('drops late progress after a failed decrypt run too', async () => {
        const trace: string[] = [];
        const statuses: string[] = [];
        let late: ((m: string) => void) | undefined;
        const { worker } = makeWorker(trace);
        worker.decryptData = async (_d, _h, onProgress) => {
            late = onProgress;
            throw new Error('bad tag');
        };
        await expect(
            finishDecryptRun({ file: makeFile('d.csv') }, makeDeps(trace, statuses, worker), PARSE)
        ).rejects.toThrow('bad tag');
        const before = [...statuses];
        late?.('Decrypting row 0/60');
        expect(statuses).toEqual(before);
    });
});
