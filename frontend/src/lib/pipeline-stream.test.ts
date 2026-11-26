import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finishRun } from './pipeline';
import type { ParsedDataset, RunDeps } from './pipeline';
import { EXCLUSION_UNAVAILABLE } from './pipeline-stream';
import { PARSE, makeFile, makeSink, installArtifactMocks } from '../test/pipeline-fakes';
import type { StreamResult } from '../types/data';

const STREAMED: ParsedDataset = {
    headers: PARSE.headers,
    data: PARSE.data,
    metadata: PARSE.metadata,
    fileHash: '',
    streamed: true,
};

const result = (over: Partial<StreamResult> = {}): StreamResult => ({
    counts: { 0: 7, 1: 7 },
    totalRows: 7,
    fileHash: 'streamhash',
    blob: new Blob(['out']),
    ...over,
});

const setup = (streamAnonymize: NonNullable<RunDeps['worker']['streamAnonymize']>) => {
    const trace: string[] = [];
    const audit = makeSink(trace);
    const anonymizeData = vi.fn();
    const worker = {
        streamAnonymize,
        anonymizeData,
        parseFile: vi.fn(),
        decryptData: vi.fn(),
        generateFile: vi.fn(),
    } as unknown as RunDeps['worker'];
    return { trace, audit, worker, anonymizeData, deps: { worker, audit, onStatus: vi.fn() } as RunDeps };
};

beforeEach(() => {
    installArtifactMocks();
});

describe('finishRun on a streamed parse', () => {
    it('streams the file instead of anonymising the preview rows, audit counts from the stream', async () => {
        const stream = vi.fn(async () => result());
        const { deps, audit, anonymizeData, worker } = setup(stream);
        const file = makeFile('big.csv');
        const { counts, artifacts } = await finishRun(
            { file, policies: { 0: { type: 'hash' }, 1: { type: 'mask' } } },
            deps,
            STREAMED
        );

        expect(stream).toHaveBeenCalledTimes(1);
        expect(anonymizeData).not.toHaveBeenCalled();
        expect(worker.generateFile).not.toHaveBeenCalled();
        expect(counts).toEqual({ 0: 7, 1: 7 });

        const log = audit.getLog()!;
        expect(log.totalRows).toBe(7);
        expect(log.fileHash).toBe('streamhash');
        expect(log.status).toBe('completed');
        expect(log.entries.map((e) => [e.columnName, e.operation, e.rowsAffected])).toEqual([
            ['name', 'hash', 7],
            ['email', 'mask', 7],
            ['joined', 'keep', 0],
        ]);
        expect(artifacts.map((a) => a.name)).toEqual(['anonymized-big.csv', 'big_audit.json']);
    });

    it('records keying and generalisation parameters in the streamed audit log', async () => {
        const { deps, audit } = setup(vi.fn(async () => result()));
        await finishRun(
            {
                file: makeFile('big.csv'),
                policies: {
                    0: { type: 'hash', keying: 'run' },
                    1: { type: 'age-band', width: 5, referenceDate: '2026-01-01' },
                    2: { type: 'bucket' },
                },
            },
            deps,
            STREAMED
        );
        const [a, b, c] = audit.getLog()!.entries;
        expect(a.keying).toBe('run');
        expect(b.details).toBe('width 5, reference date 2026-01-01');
        expect(c.details).toBe('width 10');
    });

    it('offers no main download when a file handle already wrote the output', async () => {
        const { deps } = setup(vi.fn(async () => result({ blob: null })));
        const { artifacts } = await finishRun({ file: makeFile('big.tsv'), policies: {} }, deps, STREAMED);
        expect(artifacts.map((a) => a.name)).toEqual(['big_audit.json']);
    });

    it('forwards byte progress from the worker to the page', async () => {
        const onProgress = vi.fn();
        const { deps } = setup(
            vi.fn(async (_f, _p, _o, _h, cb) => {
                cb?.({ bytes: 5, total: 10, rows: 3 });
                return result();
            })
        );
        await finishRun({ file: makeFile('big.csv'), policies: {} }, { ...deps, onProgress }, STREAMED);
        expect(onProgress).toHaveBeenCalledWith({ bytes: 5, total: 10, rows: 3 });
    });

    it('leaves a FAILED log when the stream dies (and never a completed one)', async () => {
        const { deps, audit } = setup(
            vi.fn(async () => {
                throw new Error('disk full');
            })
        );
        await expect(finishRun({ file: makeFile('big.csv'), policies: {} }, deps, STREAMED)).rejects.toThrow('disk full');
        expect(audit.getLog()?.status).toBe('failed');
        expect(audit.getLog()?.errorMessage).toBe('disk full');
    });

    it('refuses row exclusion on a streamed file with a clear message', async () => {
        const stream = vi.fn(async () => result());
        const { deps, audit } = setup(stream);
        await expect(
            finishRun({ file: makeFile('big.csv'), policies: {}, excludedRows: new Set([1]) }, deps, STREAMED)
        ).rejects.toThrow(EXCLUSION_UNAVAILABLE);
        expect(stream).not.toHaveBeenCalled();
        expect(audit.getLog()?.status).toBe('failed');
    });

    it('stops with the shared Cancelled message when the save dialog is dismissed', async () => {
        const picker = vi.fn().mockRejectedValue(new DOMException('dismissed', 'AbortError'));
        vi.stubGlobal('showSaveFilePicker', picker);
        const stream = vi.fn(async () => result());
        const { deps } = setup(stream);
        await expect(finishRun({ file: makeFile('big.csv'), policies: {} }, deps, STREAMED)).rejects.toThrow('Cancelled.');
        expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'anonymized-big.csv' }));
        expect(stream).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('hands the picked File System Access handle to the worker', async () => {
        const handle = { createWritable: vi.fn() };
        vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue(handle));
        const stream = vi.fn(async () => result({ blob: null }));
        const { deps } = setup(stream);
        await finishRun({ file: makeFile('big.jsonl'), policies: {} }, deps, STREAMED);
        expect((stream.mock.calls as unknown[][])[0][3]).toBe(handle);
        vi.unstubAllGlobals();
    });
});
