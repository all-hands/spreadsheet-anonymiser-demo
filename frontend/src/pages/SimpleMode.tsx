import { useState } from 'react';
import Explain from '../components/Explain';
import { Dropzone } from '../components/Dropzone';
import ColumnChooser from '../components/simple/ColumnChooser';
import DownloadLinks from '../components/DownloadLinks';
import { createWorker } from '../lib/worker-client';
import type { ParseResult } from '../lib/worker-client';
import { fileProblem, parseProblem } from '../lib/file-validation';
import { SUPPORTED_FORMATS_LABEL } from '../lib/constants';
import { isCancelled } from '../lib/cancel';
import { useRunProgress } from '../hooks/useRunProgress';
import RunProgress from '../components/RunProgress';
import { logFailure } from '../lib/log';
import PseudonymisationNotice from '../components/PseudonymisationNotice';
import { finishRun } from '../lib/pipeline';
import { revokeArtifacts } from '../lib/download';
import type { Artifact } from '../lib/download';
import { useAuditStore } from '../store/auditStore';
import type { ColumnPolicy } from '../types/policy';

interface Picked {
    file: File;
    parse: ParseResult;
}

const SimpleMode = () => {
    const [status, setStatus] = useState('');
    const [isError, setIsError] = useState(false);
    const [busy, setBusy] = useState(false);
    const [picked, setPicked] = useState<Picked | null>(null);
    const [artifacts, setArtifacts] = useState<Artifact[]>([]);
    const runProgress = useRunProgress();

    const handleFile = async (file: File) => {
        const problem = fileProblem(file);
        if (problem) {
            setIsError(true);
            setStatus(`Error: ${problem}`);
            return;
        }
        setIsError(false);
        setBusy(true);
        setStatus(`Parsing ${file.name}...`);
        useAuditStore.getState().clearCurrentLog();
        setArtifacts((prev) => {
            revokeArtifacts(prev);
            return [];
        });

        try {
            const worker = createWorker();
            const parse = await worker.parseFile(file, (msg: string) => setStatus(msg));
            const empty = parseProblem(parse);
            if (empty) {
                setPicked(null);
                setIsError(true);
                setStatus(`Error: ${empty}`);
                return;
            }
            setPicked({ file, parse });
        } catch (err: unknown) {
            logFailure('Parse failed', err);
            setIsError(true);
            setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setBusy(false);
        }
    };

    const handleRun = async (policies: Record<number, ColumnPolicy>) => {
        if (!picked) return;
        setBusy(true);
        setIsError(false);

        try {
            const worker = createWorker();
            const { artifacts: produced } = await finishRun(
                { file: picked.file, policies },
                {
                    worker,
                    audit: useAuditStore.getState(),
                    onStatus: setStatus,
                    onProgress: runProgress.onProgress,
                },
                picked.parse
            );
            setArtifacts((prev) => {
                revokeArtifacts(prev);
                return produced;
            });
            setStatus('Done. Downloaded the data file and its audit log.');
        } catch (err: unknown) {
            if (isCancelled(err)) {
                setStatus('Cancelled.');
            } else {
                logFailure('Run failed', err);
                setIsError(true);
                setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
        } finally {
            runProgress.reset();
            setBusy(false);
        }
    };

    const resetPicked = () => {
        setPicked(null);
        setArtifacts((prev) => {
            revokeArtifacts(prev);
            return [];
        });
        setStatus('');
        setIsError(false);
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="text-center space-y-2">
                <Explain k={picked ? 'choose.heading' : 'upload.heading'}>
                    <h2 className="text-2xl font-semibold text-foreground">
                        {picked ? 'Choose anonymisation' : 'Upload File'}
                    </h2>
                </Explain>
                <Explain k="file.name">
                    <p className="text-muted">
                        {picked ? picked.file.name : `Supported formats: ${SUPPORTED_FORMATS_LABEL}`}
                    </p>
                </Explain>
            </div>
            {picked ? (
                <div className="flex flex-col gap-4">
                    <PseudonymisationNotice />
                    <ColumnChooser
                        headers={picked.parse.headers}
                        metadata={picked.parse.metadata}
                        rows={picked.parse.data}
                        onRun={handleRun}
                        disabled={busy}
                    />
                    <Explain k="file.different">
                        <button
                            type="button"
                            onClick={resetPicked}
                            disabled={busy}
                            className="self-center px-4 py-2 bg-surface-2 hover:bg-surface-hover disabled:opacity-50 rounded-lg text-foreground text-sm transition-colors"
                        >
                            Choose a different file
                        </button>
                    </Explain>
                </div>
            ) : (
                <Dropzone onFile={handleFile} />
            )}
            {status && (
                <Explain k="status">
                <p
                    role={isError ? 'alert' : 'status'}
                    className={`text-center font-mono text-sm px-3 py-1 rounded-sm self-center ${
                        isError ? 'text-danger' : 'text-success'
                    }`}
                >
                    {status}
                </p>
                </Explain>
            )}
            <RunProgress progress={runProgress.progress} onCancel={runProgress.cancel} />
            <DownloadLinks artifacts={artifacts} />
        </div>
    );
};

export default SimpleMode;
