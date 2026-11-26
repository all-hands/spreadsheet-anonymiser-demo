import * as Comlink from 'comlink';

import type {
    AnonymizeResult,
    ColumnMetadata,
    ParseResult,
    RowData,
    StreamProgress,
    StreamResult,
} from '../types/data';
import type { AnonymizeOpts, ColumnPolicy } from '../types/policy';
import type { TableFormat } from './table-format';
import type { AnonymityPlan, ColumnKind } from './anonymity-plan';
import type { AtRiskRow } from '../workers/anonymity-plan';
import type { MeasureResult, ReleaseCheck, SuppressMode } from '../types/anonymity';
export type {
    Cell,
    Rows,
    RowData,
    ParseResult,
    AnonymizeResult,
    StreamProgress,
    StreamResult,
} from '../types/data';
export type { AnonymizeOpts } from '../types/policy';

export interface WorkerApi {
    parseFile(file: File, onProgress?: (msg: string) => void): Promise<ParseResult>;
    startSession(
        passphrase: string,
        onProgress?: (msg: string) => void
    ): Promise<Uint8Array>;
    endSession(): Promise<void>;
    anonymizeData(
        data: RowData[],
        headers: string[],
        metadata: ColumnMetadata[],
        policies: Record<number, ColumnPolicy>,
        onProgress?: (msg: string) => void,
        opts?: AnonymizeOpts
    ): Promise<AnonymizeResult>;
    decryptData(
        data: RowData[],
        headers: string[],
        onProgress?: (msg: string) => void,
        opts?: AnonymizeOpts
    ): Promise<{ data: RowData[]; decrypted: number }>;
    generateFile(headers: string[], data: RowData[], type: TableFormat): Promise<Blob>;
    measureAnonymity(
        data: RowData[],
        headers: string[],
        metadata: ColumnMetadata[],
        policies: Record<number, ColumnPolicy>,
        opts: AnonymizeOpts,
        qi: number[],
        k: number,
        onProgress?: (msg: string) => void
    ): Promise<MeasureResult>;
    planAnonymity(
        data: RowData[],
        headers: string[],
        metadata: ColumnMetadata[],
        opts: AnonymizeOpts,
        qi: number[],
        kinds: ColumnKind[],
        k: number,
        budget: number
    ): Promise<AnonymityPlan>;
    atRiskRows(
        data: RowData[],
        headers: string[],
        metadata: ColumnMetadata[],
        policies: Record<number, ColumnPolicy>,
        opts: AnonymizeOpts,
        qi: number[],
        k: number
    ): Promise<AtRiskRow[]>;
    suppressForRelease(
        data: RowData[],
        headers: string[],
        qi: number[],
        k: number,
        mode: SuppressMode
    ): Promise<{ data: RowData[]; check: ReleaseCheck }>;
    streamAnonymize(
        file: File,
        policies: Record<number, ColumnPolicy>,
        opts?: AnonymizeOpts,
        handle?: FileSystemFileHandle | null,
        onProgress?: (p: StreamProgress) => void
    ): Promise<StreamResult>;
    cancelStream(): Promise<void>;
}

export class WorkerFatalError extends Error {
    constructor(cause: string) {
        super(`processing engine failed: ${cause}`);
        this.name = 'WorkerFatalError';
    }
}

type WorkerFactory = () => Worker;

const defaultWorkerFactory: WorkerFactory = () =>
    new Worker(new URL('../workers/processing.worker.ts', import.meta.url), {
        type: 'module',
    });

let sharedWorker: Comlink.Remote<WorkerApi> | null = null;
let workerDied: Promise<never> | null = null;
let workerFactory: WorkerFactory = defaultWorkerFactory;

export const setWorkerFactoryForTests = (factory: WorkerFactory | null): void => {
    workerFactory = factory ?? defaultWorkerFactory;
    sharedWorker = null;
    workerDied = null;
};

const createWorker = (): Comlink.Remote<WorkerApi> => {
    if (sharedWorker) return sharedWorker;
    const worker = workerFactory();

    workerDied = new Promise<never>((_, reject) => {
        worker.onerror = (e) => reject(new WorkerFatalError(e.message || 'worker failed to load'));
        worker.onmessageerror = () => reject(new WorkerFatalError('worker message failed to serialize'));
    });

    const remote = Comlink.wrap<WorkerApi>(worker);
    const PROMISE_PROTOCOL = new Set(['then', 'catch', 'finally']);
    sharedWorker = new Proxy(remote, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (
                typeof prop !== 'string' ||
                PROMISE_PROTOCOL.has(prop) ||
                typeof value !== 'function' ||
                !workerDied
            ) {
                return value;
            }
            return (...args: unknown[]) => {
                const wire = args.map((a) =>
                    typeof a === 'function' ? Comlink.proxy(a) : a
                );
                return Promise.race([value(...wire), workerDied]);
            };
        },
    }) as Comlink.Remote<WorkerApi>;
    return sharedWorker;
};

export { createWorker };
