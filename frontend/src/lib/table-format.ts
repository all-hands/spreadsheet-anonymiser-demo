import { STREAM_THRESHOLD_BYTES } from './constants';
import { extensionOf } from './file-validation';
import type { TextTableFormat } from './table/codec';

export type WorkbookFormat = 'xlsx' | 'ods';
export type TableFormat = TextTableFormat | WorkbookFormat;

export const isWorkbook = (format: TableFormat): format is WorkbookFormat => format === 'xlsx' || format === 'ods';

export const tableFormatOf = (name: string): TableFormat => {
    switch (extensionOf(name)) {
        case '.xlsx':
            return 'xlsx';
        case '.ods':
            return 'ods';
        case '.tsv':
        case '.tab':
            return 'tsv';
        case '.jsonl':
        case '.ndjson':
            return 'jsonl';
        default:
            return 'csv';
    }
};

export const shouldStream = (file: { name: string; size: number }): boolean =>
    !isWorkbook(tableFormatOf(file.name)) && file.size > STREAM_THRESHOLD_BYTES;
