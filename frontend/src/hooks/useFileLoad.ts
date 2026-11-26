import { fileProblem, parseProblem } from '../lib/file-validation';
import { createWorker } from '../lib/worker-client';
import { useDatasetStore } from '../store/datasetStore';
import { useAdvancedSessionStore } from '../store/advancedSessionStore';
import { defaultPolicies } from '../lib/pipeline';
import type { ColumnMetadata, RowData } from '../types/data';

export interface FileParse {
    fileHash?: string;
    headers: string[];
    fullData: RowData[];
    previewData: RowData[];
    metadata: ColumnMetadata[];
    streamed?: boolean;
}

export const useFileLoad = (
    onStatus: (msg: string) => void,
    onBusy: (busy: boolean) => void
): {
    file: File | null;
    parse: FileParse | null;
    loadFile: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
} => {
    const file = useAdvancedSessionStore((s) => s.file);
    const parse = useAdvancedSessionStore((s) => s.parse);

    const loadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const selectedFile = e.target.files[0];
        const problem = fileProblem(selectedFile);
        if (problem) {
            onStatus(`Error: ${problem}`);
            return;
        }
        useAdvancedSessionStore.getState().beginFile(selectedFile);
        const token = useAdvancedSessionStore.getState().loadSeq;
        const current = () => useAdvancedSessionStore.getState().loadSeq === token;
        let done = false;
        onBusy(true);
        onStatus('Parsing file...');

        try {
            const worker = createWorker();
            const result = await worker.parseFile(
                selectedFile,
                (msg: string) => {
                    if (current() && !done) onStatus(msg);
                }
            );

            done = true;
            if (!current()) return;
            const empty = parseProblem(result);
            if (empty) {
                useAdvancedSessionStore.getState().clearSession();
                onBusy(false);
                onStatus(`Error: ${empty}`);
                return;
            }
            useAdvancedSessionStore.getState().setParse({
                fileHash: result.fileHash,
                headers: result.headers,
                fullData: result.data,
                previewData: result.data.slice(0, 10),
                metadata: result.metadata,
                streamed: result.streamed,
            });
            useDatasetStore.getState().setFileData(result.headers, result.data, result.metadata);
            useDatasetStore.getState().initializePolicies(result.headers.length);

            const defaults = defaultPolicies(result.metadata);
            Object.entries(defaults).forEach(([idx, p]) => {
                useDatasetStore.getState().setPolicy(Number(idx), p.type);
            });

            onStatus(
                result.streamed
                    ? `Large file: previewing the first ${result.data.length} rows. ` +
                          'It is streamed on export; row exclusion is unavailable.'
                    : `Loaded ${result.data.length} rows.`
            );
        } catch (err: unknown) {
            done = true;
            if (!current()) return;
            const message = err instanceof Error ? err.message : 'Unknown error';
            onStatus(`Error: ${message}`);
        } finally {
            done = true;
            if (current()) onBusy(false);
        }
    };

    return { file, parse, loadFile };
};
