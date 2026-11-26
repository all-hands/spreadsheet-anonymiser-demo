import { activeColumns, anonymizeData, deriveSessionColumnKeys } from './anonymize';
import { deriveRunKeys } from './run-keys';
import type { RunKeys } from './run-keys';
import { ensureWasm } from './wasm';
import { openSink, readSlices } from './stream-io';
import type { WritableFileHandle } from './stream-io';
import { CancelledError } from '../lib/cancel';
import { STREAM_CHUNK_ROWS, STREAM_PREVIEW_ROWS } from '../lib/constants';
import { fileProblem } from '../lib/file-validation';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { isWorkbook, tableFormatOf } from '../lib/table-format';
import { createRowDecoder, encodeHeader, encodeRows } from '../lib/table/codec';
import type { TextTableFormat } from '../lib/table/codec';
import type { StreamProgress, StreamResult } from '../types/data';
import type { AnonymizeOpts, ColumnPolicy } from '../types/policy';

const MIME: Record<TextTableFormat, string> = {
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    jsonl: 'application/x-ndjson',
};

let cancelRequested = false;

export const cancelStream = (): void => {
    cancelRequested = true;
};

export type ChunkSpy = (rows: number) => void;

export const streamAnonymize = async (
    file: File,
    policies: Record<number, ColumnPolicy>,
    opts: AnonymizeOpts = {},
    handle: WritableFileHandle | null = null,
    onProgress: (p: StreamProgress) => void = () => {},
    spy?: ChunkSpy
): Promise<StreamResult> => {
    const problem = fileProblem(file);
    if (problem) throw new Error(problem);
    const format = tableFormatOf(file.name);
    if (isWorkbook(format)) throw new Error('Spreadsheets cannot be streamed.');

    cancelRequested = false;
    await ensureWasm();
    const sink = await openSink(handle, MIME[format]);
    const decoder = createRowDecoder(format);
    const hasher = sha256.create();
    const counts: Record<number, number> = {};
    let headers: string[] | null = null;
    let totalRows = 0;
    let runKeys: RunKeys | null = null;
    let sessionKeys: Map<number, Uint8Array> | null = null;

    const anonymiseBatch = async (batch: string[][]): Promise<void> => {
        spy?.(batch.length);
        const res = await anonymizeData(batch, headers!, [], policies, () => {}, opts, runKeys!, true);
        for (const [idx, n] of Object.entries(res.counts)) {
            counts[Number(idx)] = (counts[Number(idx)] ?? 0) + n;
        }
        for (const bytes of encodeRows(format, headers!, res.data)) await sink.write(bytes);
        totalRows += batch.length;
    };

    try {
        for await (const slice of readSlices(file)) {
            if (cancelRequested) throw new CancelledError();
            hasher.update(slice.bytes);
            const decoded = decoder.push(slice.text, slice.last);
            if (decoded.headers && !headers) {
                headers = decoded.headers;
                const perRun = deriveRunKeys(activeColumns(policies), policies, headers);
                try {
                    sessionKeys = deriveSessionColumnKeys(policies, headers, opts.dataset, perRun.keys);
                } catch (err) {
                    perRun.release();
                    throw err;
                }
                const merged = new Map(perRun.keys);
                sessionKeys.forEach((k, i) => merged.set(i, k));
                runKeys = { keys: merged, release: perRun.release };
                await sink.write(encodeHeader(format, headers));
            }
            for (let i = 0; i < decoded.rows.length; i += STREAM_CHUNK_ROWS) {
                await anonymiseBatch(decoded.rows.slice(i, i + STREAM_CHUNK_ROWS));
            }
            onProgress({ bytes: slice.end, total: file.size, rows: totalRows });
        }
        if (cancelRequested) throw new CancelledError();
        if (!headers) throw new Error('No rows found in the file.');
        const blob = await sink.finish();
        return { counts, totalRows, fileHash: bytesToHex(hasher.digest()), blob };
    } catch (e) {
        await sink.abort();
        throw e;
    } finally {
        decoder.free();
        runKeys?.release();
        sessionKeys?.forEach((k) => k.fill(0));
    }
};

export const readPreview = async (
    file: File,
    format: TextTableFormat,
    maxRows: number = STREAM_PREVIEW_ROWS
): Promise<{ headers: string[]; rows: string[][] }> => {
    const decoder = createRowDecoder(format);
    let headers: string[] | null = null;
    const rows: string[][] = [];
    try {
        for await (const slice of readSlices(file)) {
            const d = decoder.push(slice.text, slice.last);
            headers ??= d.headers;
            for (const r of d.rows) rows.push(r);
            if (headers && rows.length >= maxRows) break;
        }
    } finally {
        decoder.free();
    }
    if (!headers) throw new Error('No rows found in the file.');
    return { headers, rows: rows.slice(0, maxRows) };
};
