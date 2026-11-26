import { STREAM_SLICE_BYTES } from '../lib/constants';
import type { EncodedBytes } from '../lib/table/codec';

export interface Slice {
    bytes: Uint8Array;
    text: string;
    end: number;
    last: boolean;
}

export const NOT_UTF8 =
    'This file is not valid UTF-8 text, so it cannot be read without changing its data. ' +
    'Save it as UTF-8 (in Excel: "CSV UTF-8") and try again.';

export const tableTextDecoder = (): TextDecoder =>
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export const decodeTableText = (decoder: TextDecoder, bytes: Uint8Array, stream = false): string => {
    try {
        return decoder.decode(bytes, { stream });
    } catch (e) {
        throw new Error(NOT_UTF8, { cause: e });
    }
};

export async function* readSlices(
    file: Blob,
    sliceBytes: number = STREAM_SLICE_BYTES
): AsyncGenerator<Slice> {
    const decoder = tableTextDecoder();
    for (let off = 0; off < file.size; off += sliceBytes) {
        const end = Math.min(off + sliceBytes, file.size);
        const bytes = new Uint8Array(await file.slice(off, end).arrayBuffer());
        const last = end >= file.size;
        yield { bytes, text: decodeTableText(decoder, bytes, !last), end, last };
    }
}

export interface WritableFileHandle {
    createWritable(): Promise<{
        write(data: EncodedBytes): Promise<void>;
        close(): Promise<void>;
        abort(): Promise<void>;
    }>;
}

export interface OutputSink {
    write(bytes: EncodedBytes): Promise<void>;
    finish(): Promise<Blob | null>;
    abort(): Promise<void>;
}

const fileSink = async (handle: WritableFileHandle): Promise<OutputSink> => {
    const w = await handle.createWritable();
    return {
        write: (bytes) => w.write(bytes),
        finish: async () => {
            await w.close();
            return null;
        },
        abort: () => w.abort().catch(() => {}),
    };
};

const blobSink = (mime: string): OutputSink => {
    let parts: Blob[] = [];
    return {
        write: async (bytes) => {
            parts.push(new Blob([bytes]));
        },
        finish: async () => {
            const blob = new Blob(parts, { type: mime });
            parts = [];
            return blob;
        },
        abort: async () => {
            parts = [];
        },
    };
};

export const openSink = (handle: WritableFileHandle | null, mime: string): Promise<OutputSink> =>
    handle ? fileSink(handle) : Promise.resolve(blobSink(mime));
