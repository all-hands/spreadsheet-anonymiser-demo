import { vi } from 'vitest';
import type { WorkerApi, ParseResult, RowData } from '../lib/worker-client';
import type { AuditSink, RunDeps } from '../lib/pipeline';
import type { AnonymizeOpts, ColumnPolicy } from '../types/policy';
import type { AuditLog } from '../types/audit';
import type { TableFormat } from '../lib/table-format';

export const PARSE: ParseResult = {
    headers: ['name', 'email', 'joined'],
    data: [
        ['Ann', 'a@x.com', '2024-01-01'],
        ['Bo', 'b@x.com', '2024-02-02'],
    ],
    metadata: [
        { index: 0, header: 'name', type: 'text', confidence: 1 },
        { index: 1, header: 'email', type: 'email', confidence: 1 },
        { index: 2, header: 'joined', type: 'date', confidence: 1 },
    ],
    fileHash: 'deadbeef',
};

export const makeFile = (name: string) => new File(['name,email\n'], name, { type: 'text/csv' });

export const blobText = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
    });

export const makeSink = (trace: string[]): AuditSink => {
    let log: AuditLog | null = null;
    return {
        getLog: () => log,
        startNewLog: (filename, fileSize, totalRows, totalColumns, fileHash) => {
            trace.push('startNewLog');
            log = {
                id: 'log-1',
                createdAt: 1,
                filename,
                fileSize,
                fileHash,
                totalRows,
                totalColumns,
                entries: [],
                status: 'pending',
            };
            return 'log-1';
        },
        addEntry: (entry) => {
            trace.push('addEntry');
            if (log) log.entries.push({ ...entry, id: `e${log.entries.length}`, timestamp: 2 });
        },
        completeLog: () => {
            trace.push('completeLog');
            if (log) log = { ...log, status: 'completed', completedAt: 3 };
        },
        failLog: (errorMessage) => {
            trace.push('failLog');
            if (log) log = { ...log, status: 'failed', errorMessage, completedAt: 3 };
        },
    };
};

export interface FakeWorkerCalls {
    anonymizePolicies?: Record<number, ColumnPolicy>;
    anonymizeOpts?: AnonymizeOpts;
    anonymizeRows?: RowData[];
    decryptOpts?: AnonymizeOpts;
    decryptRows?: RowData[];
    generateType?: TableFormat;
    generateRows?: RowData[];
}

export const makeWorker = (
    trace: string[],
    opts: {
        counts?: Record<number, number>;
        decrypted?: number;
        throwOn?: 'anonymize' | 'decrypt' | 'generate';
    } = {}
) => {
    const calls: FakeWorkerCalls = {};
    const worker: Pick<
        WorkerApi,
        'parseFile' | 'anonymizeData' | 'decryptData' | 'generateFile'
    > = {
        parseFile: async (file, onProgress) => {
            trace.push('parse');
            onProgress?.(`Starting parse for ${file.name}`);
            return PARSE;
        },
        anonymizeData: async (data, _headers, _metadata, policies, onProgress, runOpts) => {
            trace.push('anonymize');
            if (opts.throwOn === 'anonymize') throw new Error('boom-anonymize');
            calls.anonymizePolicies = policies;
            calls.anonymizeOpts = runOpts;
            calls.anonymizeRows = data;
            onProgress?.('Anonymising row 0/2');
            return { data, counts: opts.counts ?? { 1: 2, 2: 2 } };
        },
        decryptData: async (data, _headers, onProgress, runOpts) => {
            trace.push('decrypt');
            if (opts.throwOn === 'decrypt') throw new Error('boom-decrypt');
            calls.decryptOpts = runOpts;
            calls.decryptRows = data;
            onProgress?.('Decrypting row 0/2');
            return { data, decrypted: opts.decrypted ?? 2 };
        },
        generateFile: async (_headers, rows, type) => {
            trace.push('generate');
            if (opts.throwOn === 'generate') throw new Error('boom-generate');
            calls.generateType = type;
            calls.generateRows = rows;
            return new Blob(['anonymized'], { type: 'text/csv' });
        },
    };
    return { worker, calls };
};

export const makeDeps = (
    trace: string[],
    statuses: string[],
    worker: Pick<WorkerApi, 'parseFile' | 'anonymizeData' | 'decryptData' | 'generateFile'>
): RunDeps => ({
    worker,
    audit: makeSink(trace),
    onStatus: (msg) => statuses.push(msg),
});

const clickMock = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

export const installArtifactMocks = () => {
    const createdBlobs: Blob[] = [];
    let urlCounter = 0;
    URL.createObjectURL = vi.fn((obj: Blob | MediaSource) => {
        createdBlobs.push(obj as Blob);
        return `blob:mock-${++urlCounter}`;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    clickMock.mockClear();
    return { createdBlobs, clickMock };
};
