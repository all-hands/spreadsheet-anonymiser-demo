import { MAX_FILE_BYTES, MAX_STREAM_FILE_BYTES, SUPPORTED_EXTENSIONS } from './constants';
import { formatBytes } from './format';

export const extensionOf = (name: string): string => {
    const dot = name.lastIndexOf('.');
    return dot < 0 ? '' : name.slice(dot).toLowerCase();
};

export const fileProblem = (file: { name: string; size: number }): string | null => {
    const ext = extensionOf(file.name);
    if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
        return (
            `Unsupported file format${ext ? ` "${ext}"` : ''}. ` +
            'The browser version only supports .csv, .tsv, .jsonl, .xlsx and .ods files.'
        );
    }
    const limit = ext === '.xlsx' || ext === '.ods' ? MAX_FILE_BYTES : MAX_STREAM_FILE_BYTES;
    if (file.size > limit) {
        return (
            `This file is ${formatBytes(file.size)}, over the ${formatBytes(limit)} ` +
            'limit of the browser version. Use the command-line tool (anonymiser-cli) for larger files.'
        );
    }
    return null;
};

export const parseProblem = (parse: { headers: string[]; data: unknown[] }): string | null => {
    if (parse.headers.length === 0) {
        return 'This file is empty. Choose a file that has a header row and at least one data row.';
    }
    if (parse.data.length === 0) {
        return 'This file has a header row but no data rows, so there is nothing to anonymise.';
    }
    return null;
};
