import { writeSheet } from './xlsx';
import { writeOdsSheet } from './ods';
import { encodeHeader, encodeRows } from '../lib/table/codec';
import { ensureWasm } from './wasm';
import type { TableFormat } from '../lib/table-format';
import type { Rows } from '../types/data';

const MIME = {
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    jsonl: 'application/x-ndjson',
} as const;

export const generateFile = async (headers: string[], data: Rows, type: TableFormat): Promise<Blob> => {
    if (type === 'xlsx') return writeSheet(headers, data);
    if (type === 'ods') return writeOdsSheet(headers, data);
    await ensureWasm();
    return new Blob([encodeHeader(type, headers), ...encodeRows(type, headers, data)], {
        type: MIME[type],
    });
};
