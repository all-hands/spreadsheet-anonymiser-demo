export const PREVIEW_ROW_LIMIT = 50;

export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export const MAX_XLSX_ENTRY_BYTES = 512 * 1024 * 1024;

export const MAX_STREAM_FILE_BYTES = 2 * 1024 * 1024 * 1024;

export const STREAM_THRESHOLD_BYTES = 32 * 1024 * 1024;

export const STREAM_CHUNK_ROWS = 5000;

export const STREAM_SLICE_BYTES = 2 * 1024 * 1024;

export const STREAM_PREVIEW_ROWS = 1000;

export const SUPPORTED_EXTENSIONS = ['.csv', '.tsv', '.tab', '.jsonl', '.ndjson', '.xlsx', '.ods'] as const;

export const ACCEPT_ATTRIBUTE = SUPPORTED_EXTENSIONS.join(',');

export const SUPPORTED_FORMATS_LABEL = '.xlsx, .ods, .csv, .tsv, .jsonl';
