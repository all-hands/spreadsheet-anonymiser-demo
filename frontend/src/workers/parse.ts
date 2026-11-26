import { analyzeColumns } from '../lib/detectors';
import { ensureWasm } from './wasm';
import { fileProblem } from '../lib/file-validation';
import { isWorkbook, shouldStream, tableFormatOf } from '../lib/table-format';
import { readFirstSheet } from './xlsx';
import { readFirstOdsSheet } from './ods';
import { parseTextInMemory, parseTextPreview, sha256Hex } from './parse-text';
import type { ParseResult } from '../types/data';

export { sha256Hex };

export const parseFile = async (
    file: File,
    onProgress: (msg: string) => void = () => {}
): Promise<ParseResult> => {
    const problem = fileProblem(file);
    if (problem) throw new Error(problem);
    onProgress(`Starting parse for ${file.name}`);
    await ensureWasm();
    const format = tableFormatOf(file.name);
    if (!isWorkbook(format)) {
        return shouldStream(file)
            ? parseTextPreview(file, format, onProgress)
            : parseTextInMemory(file, format, onProgress);
    }

    const buffer = await file.arrayBuffer();
    const fileHash = await sha256Hex(buffer);
    try {
        const { headers, rows } = await (format === 'ods' ? readFirstOdsSheet : readFirstSheet)(buffer);
        const metadata = analyzeColumns(headers, rows);
        onProgress(`Loaded ${rows.length} rows.`);

        return { headers, data: rows, metadata, fileHash };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        throw new Error(`${format === 'ods' ? 'ODS' : 'Excel'} parse failed: ${message}`, { cause: e });
    }
};
