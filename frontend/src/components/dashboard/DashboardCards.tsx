import DownloadLinks from '../DownloadLinks';
import type { Artifact } from '../../lib/download';
import type { KeyStatus } from '../../hooks/useKeyedSession';
import { TOKEN_ENCODING_STRINGS } from '../../types/policy';
import type { TokenEncoding } from '../../types/policy';
import { clsx } from 'clsx';
import { ACCEPT_ATTRIBUTE } from '../../lib/constants';
import { DemoFiles } from '../DemoFiles';
import Explain from '../Explain';
import { Upload, Play, KeyRound, CircleX, LockOpen, FileBraces, FolderOpen, RotateCcw } from 'lucide-react';

interface DashboardCardsProps {
    file: File | null;
    onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
    status: string;
    artifacts: Artifact[];
    policyArtifacts: Artifact[];
    passphrase: string;
    setPassphrase: (p: string) => void;
    keyStatus: KeyStatus;
    onEnableKey: () => void;
    onDisableKey: () => void;
    isProcessing: boolean;
    onProcess: () => void;
    processBlockedReason?: string | null;
    dataset: string;
    setDataset: (v: string) => void;
    tokenEncoding: TokenEncoding;
    setTokenEncoding: (t: TokenEncoding) => void;
    hasHeaders: boolean;
    onExportPolicy: () => void;
    onImportPolicy: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onDecrypt: () => void;
    onClear: () => void;
}

const DashboardCards = ({
    file,
    onFileSelect,
    status,
    artifacts,
    policyArtifacts,
    passphrase,
    setPassphrase,
    keyStatus,
    onEnableKey,
    onDisableKey,
    isProcessing,
    onProcess,
    processBlockedReason,
    dataset,
    setDataset,
    tokenEncoding,
    setTokenEncoding,
    hasHeaders,
    onExportPolicy,
    onImportPolicy,
    onDecrypt,
    onClear,
}: DashboardCardsProps) => {
    const hasFile = file !== null;
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-4 *:min-w-0">
            <div className="p-4 rounded-xl bg-surface border border-border flex flex-col justify-between">
                <Explain k="card.source"><span className="text-muted text-xs uppercase tracking-wider">Source File</span></Explain>
                <div className="mt-2 flex items-center justify-between">
                    <Explain k="file.name"><span className="text-foreground font-medium truncate">{file ? file.name : 'No file selected'}</span></Explain>
                    <Explain k="file.choose">
                    <label className="cursor-pointer p-2 bg-surface-2 hover:bg-surface-hover rounded-lg text-foreground transition-colors focus-within:ring-2 focus-within:ring-accent">
                        <Upload size={16} aria-hidden="true" />
                        <input type="file" className="sr-only" onChange={onFileSelect} accept={ACCEPT_ATTRIBUTE} aria-label="Choose a CSV, TSV, JSONL, Excel or ODS file" />
                    </label>
                    </Explain>
                </div>
                <Explain k="file.clear">
                <button
                    type="button"
                    onClick={onClear}
                    disabled={!hasFile || isProcessing}
                    className="mt-3 flex items-center gap-2 self-start rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs text-foreground hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <RotateCcw size={14} aria-hidden="true" /> Clear file / start over
                </button>
                </Explain>
                <div className="mt-3">
                    <DemoFiles
                        align="start"
                        onFile={(f) =>
                            onFileSelect({ target: { files: [f] } } as unknown as React.ChangeEvent<HTMLInputElement>)
                        }
                    />
                </div>
            </div>

            <div className="p-4 rounded-xl bg-surface border border-border">
                <Explain k="card.status"><span className="text-muted text-xs uppercase tracking-wider">Status</span></Explain>
                <Explain k="status">
                <p
                    role="status"
                    className={clsx('mt-1 text-sm font-mono', status.startsWith('Error') ? 'text-danger' : 'text-success')}
                >
                    {status || 'Idle'}
                </p>
                </Explain>
                <DownloadLinks artifacts={artifacts} />
                <DownloadLinks artifacts={policyArtifacts} />
            </div>

            <div className="p-4 rounded-xl bg-surface border border-border flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <Explain k="card.keyed"><span className="text-muted text-xs uppercase tracking-wider">Keyed Hashing</span></Explain>
                    {keyStatus === 'active' ? (
                        <Explain k="key.active"><p className="mt-1 text-success text-sm font-mono">Keyed session active</p></Explain>
                    ) : (
                        <Explain k="key.passphrase">
                        <input
                            type="password"
                            autoComplete="new-password"
                            value={passphrase}
                            onChange={(e) => setPassphrase(e.target.value)}
                            placeholder="Passphrase (optional)"
                            aria-label="Passphrase for keyed hashing"
                            className="mt-1 w-full bg-surface border border-border rounded-lg px-2 py-1 text-sm text-foreground focus:outline-hidden focus:border-accent"
                        />
                        </Explain>
                    )}
                </div>
                {keyStatus === 'active' ? (
                    <Explain k="key.clear">
                    <button
                        onClick={onDisableKey}
                        disabled={isProcessing}
                        aria-label="Clear keyed session"
                        className="p-2 bg-surface-2 hover:bg-surface-hover rounded-lg text-danger transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <CircleX size={16} />
                    </button>
                    </Explain>
                ) : (
                    <Explain k="key.derive">
                    <button
                        onClick={onEnableKey}
                        disabled={keyStatus === 'deriving' || !passphrase || isProcessing}
                        aria-label="Derive session key from passphrase"
                        className={clsx(
                            "p-2 rounded-lg transition-colors",
                            keyStatus === 'deriving' || !passphrase
                                ? "bg-surface-2 text-muted cursor-not-allowed"
                                : "bg-surface-2 hover:bg-surface-hover text-warning"
                        )}
                    >
                        <KeyRound size={16} />
                    </button>
                    </Explain>
                )}
            </div>

            <div className="p-4 rounded-xl bg-surface border border-border flex flex-col gap-3 justify-center">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div>
                        <Explain k="card.action"><span className="text-muted text-xs uppercase tracking-wider">Action</span></Explain>
                        <p className="text-muted text-xs mt-1">Apply policies and export</p>
                    </div>
                    <Explain k="action.process">
                    <button
                        onClick={onProcess}
                        disabled={!hasFile || isProcessing || !!processBlockedReason}
                        aria-describedby={processBlockedReason ? 'process-blocked' : undefined}
                        className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-accent-foreground font-medium text-sm transition-colors"
                    >
                        <Play size={16} /> Process &amp; Download
                    </button>
                    </Explain>
                </div>
                {processBlockedReason && (
                    <p id="process-blocked" className="text-warning text-xs">
                        {processBlockedReason}
                    </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div>
                        <Explain k="card.options"><span className="text-muted text-xs uppercase tracking-wider">Run options</span></Explain>
                        <p className="text-muted text-xs mt-1">Dataset scopes keyed tokens</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Explain k="opt.dataset">
                        <input
                            type="text"
                            value={dataset}
                            onChange={(e) => setDataset(e.target.value)}
                            placeholder="dataset (optional)"
                            aria-label="Dataset namespace"
                            className="w-32 min-w-0 bg-surface-2 border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-hidden focus:border-accent"
                        />
                        </Explain>
                        <Explain k={`encoding:${tokenEncoding}`}>
                        <select
                            value={tokenEncoding}
                            onChange={(e) => setTokenEncoding(e.target.value as TokenEncoding)}
                            aria-label="Token encoding"
                            className="bg-surface-2 border border-border rounded-lg px-1.5 py-1 text-xs text-foreground focus:outline-hidden focus:border-accent"
                        >
                            {TOKEN_ENCODING_STRINGS.map((t) => (
                                <option key={t} value={t}>
                                    {t}
                                </option>
                            ))}
                        </select>
                        </Explain>
                    </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div>
                        <Explain k="card.policy"><span className="text-muted text-xs uppercase tracking-wider">Policy</span></Explain>
                        <p className="text-muted text-xs mt-1">Save / load column policies</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Explain k="policy.export">
                        <button
                            onClick={onExportPolicy}
                            disabled={!hasHeaders}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface-2 hover:bg-surface-hover disabled:opacity-50 rounded-lg text-foreground text-xs transition-colors"
                        >
                            <FileBraces size={14} /> Export
                        </button>
                        </Explain>
                        <Explain k="policy.import">
                        <label
                            className={clsx(
                                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer",
                                hasHeaders ? "bg-surface-2 hover:bg-surface-hover text-foreground" : "bg-surface-2 text-muted cursor-not-allowed",
                                "focus-within:ring-2 focus-within:ring-accent"
                            )}
                        >
                            <FolderOpen size={14} /> Import
                            <input type="file" accept=".json" className="sr-only" aria-label="Import policy.json" onChange={onImportPolicy} disabled={!hasHeaders} />
                        </label>
                        </Explain>
                    </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div>
                        <Explain k="card.decrypt"><span className="text-muted text-xs uppercase tracking-wider">Decrypt</span></Explain>
                        <p className="text-muted text-xs mt-1">Reverse enc:v1: cells (needs session)</p>
                    </div>
                    <Explain k="action.decrypt">
                    <button
                        onClick={onDecrypt}
                        disabled={!hasFile || isProcessing || keyStatus !== 'active'}
                        className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-success text-xs font-medium transition-colors"
                    >
                        <LockOpen size={14} /> Decrypt &amp; Download
                    </button>
                    </Explain>
                </div>
            </div>
        </div>
    );
};

export default DashboardCards;
