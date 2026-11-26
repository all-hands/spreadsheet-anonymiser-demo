import { CancelledError } from './cancel';
import { extensionOf } from './file-validation';
import { isWorkbook, tableFormatOf } from './table-format';

interface PickerWindow {
    showSaveFilePicker?: (opts: {
        suggestedName: string;
        types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle>;
}

const MIME = {
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    jsonl: 'application/x-ndjson',
} as const;

export const pickSaveHandle = async (name: string): Promise<FileSystemFileHandle | null> => {
    const picker = (globalThis as unknown as PickerWindow).showSaveFilePicker;
    const format = tableFormatOf(name);
    if (typeof picker !== 'function' || isWorkbook(format)) return null;
    try {
        return await picker.call(globalThis, {
            suggestedName: name,
            types: [{ description: `${format.toUpperCase()} file`, accept: { [MIME[format]]: [extensionOf(name)] } }],
        });
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw new CancelledError();
        return null;
    }
};
