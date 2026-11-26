import { analyzeColumns } from '../lib/detectors';
import { createRowDecoder } from '../lib/table/codec';
import type { TextTableFormat } from '../lib/table/codec';
import { readPreview } from './stream';
import { decodeTableText, tableTextDecoder } from './stream-io';
import type { ParseResult } from '../types/data';

export const sha256Hex = async (bytes: ArrayBuffer): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
};

export const parseTextInMemory = async (
    file: File,
    format: TextTableFormat,
    onProgress: (msg: string) => void
): Promise<ParseResult> => {
    const buffer = await file.arrayBuffer();
    const fileHash = await sha256Hex(buffer);
    const text = decodeTableText(tableTextDecoder(), new Uint8Array(buffer));
    const { headers, rows } = createRowDecoder(format).push(text, true);
    if (!headers) {
        if (format === 'jsonl') throw new Error('No JSON records found in the file.');
        return { headers: [], data: [], metadata: [], fileHash };
    }
    onProgress(`Loaded ${rows.length} rows.`);
    return { headers, data: rows, metadata: analyzeColumns(headers, rows), fileHash };
};

export const parseTextPreview = async (
    file: File,
    format: TextTableFormat,
    onProgress: (msg: string) => void
): Promise<ParseResult> => {
    onProgress('Large file: reading a preview of the first rows...');
    const { headers, rows } = await readPreview(file, format);
    onProgress(`Previewing the first ${rows.length} rows; the full file is streamed on export.`);
    return {
        headers,
        data: rows,
        metadata: analyzeColumns(headers, rows),
        fileHash: '',
        streamed: true,
    };
};
