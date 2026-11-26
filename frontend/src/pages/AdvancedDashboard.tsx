import { useState } from 'react';
import { useDatasetStore } from '../store/datasetStore';
import { useAdvancedSessionStore } from '../store/advancedSessionStore';
import { useAuditStore } from '../store/auditStore';
import AuditLogPanel from '../components/AuditLogPanel';
import DashboardCards from '../components/dashboard/DashboardCards';
import PseudonymisationNotice from '../components/PseudonymisationNotice';
import AnonymityPanel from '../components/dashboard/AnonymityPanel';
import BulkPolicyBar from '../components/dashboard/BulkPolicyBar';
import RoleSuggestBar from '../components/dashboard/RoleSuggestBar';
import PolicyGrid from '../components/dashboard/PolicyGrid';
import RowExclusionPanel from '../components/dashboard/RowExclusionPanel';
import { createWorker } from '../lib/worker-client';
import { downloadBlob } from '../lib/download';
import type { Artifact } from '../lib/download';
import { finishDecryptRun, finishRun } from '../lib/pipeline';
import { keyedSessionProblem } from '../lib/pipeline-common';
import { exportPolicyDoc, importPolicyDoc } from '../lib/policy-io';
import { useFileLoad } from '../hooks/useFileLoad';
import { useKeyedSession } from '../hooks/useKeyedSession';
import { useRunProgress } from '../hooks/useRunProgress';
import { isCancelled } from '../lib/cancel';
import { directIdentifierColumns, quasiIdentifiers, releaseProblems } from '../lib/anonymity';
import RunProgress from '../components/RunProgress';

const AdvancedDashboard = () => {
    const status = useAdvancedSessionStore((s) => s.status);
    const isProcessing = useAdvancedSessionStore((s) => s.busy);
    const artifacts = useAdvancedSessionStore((s) => s.artifacts);
    const policyArtifacts = useAdvancedSessionStore((s) => s.policyArtifacts);
    const { setStatus, setBusy: setIsProcessing } = useAdvancedSessionStore.getState();

    const { file, parse, loadFile } = useFileLoad(setStatus, setIsProcessing);
    const session = useKeyedSession(setStatus);
    const runProgress = useRunProgress();
    const { salt } = session;

    const {
        policies,
        dataset,
        setDataset,
        tokenEncoding,
        setTokenEncoding,
        excludedRows,
        roles,
        anonymousRelease,
        k,
        suppressMode,
    } = useDatasetStore();
    const currentLog = useAuditStore((s) => s.currentLog);
    const passedAnonymity =
        currentLog?.status === 'completed' && currentLog.anonymity
            ? {
                  k: currentLog.anonymity.k,
                  mode: currentLog.anonymity.mode,
                  quasiIdentifiers: currentLog.anonymity.quasiIdentifiers,
              }
            : null;

    const headers = parse?.headers ?? [];
    const [selectedCols, setSelectedCols] = useState<ReadonlySet<number>>(new Set());
    const [selectionFor, setSelectionFor] = useState(parse?.headers);
    if (selectionFor !== parse?.headers) {
        setSelectionFor(parse?.headers);
        setSelectedCols(new Set());
    }
    const fullData = parse?.fullData ?? [];

    const setRunArtifacts = (produced: Artifact[]) =>
        useAdvancedSessionStore.getState().replaceArtifacts(produced);

    const processBlockedReason = anonymousRelease ? null : keyedSessionProblem(policies, salt);

    const allRowsExcluded = fullData.length > 0 && fullData.length - excludedRows.size === 0;

    const handleProcess = async () => {
        if (!file || !fullData.length) return;
        if (allRowsExcluded) {
            setStatus('All rows are excluded — nothing to export.');
            return;
        }
        const anonymity = anonymousRelease
            ? {
                  qi: quasiIdentifiers(roles, headers.length),
                  identifiers: directIdentifierColumns(roles, headers.length, parse?.metadata ?? []),
                  k,
                  mode: suppressMode,
              }
            : undefined;
        if (anonymity) {
            const problems = releaseProblems({ headers, policies, request: anonymity, streamed: parse?.streamed });
            if (problems.length) {
                setStatus(`Error: Export blocked: ${problems.join(' ')}`);
                return;
            }
        }
        const keyed = anonymity ? null : keyedSessionProblem(policies, salt);
        if (keyed) {
            setStatus(`Error: ${keyed}`);
            return;
        }
        setRunArtifacts([]);
        setIsProcessing(true);
        setStatus('Applying policies...');

        try {
            const worker = createWorker();
            const { artifacts } = await finishRun(
                { file, policies, dataset, tokenEncoding, salt: anonymity ? null : salt, excludedRows, anonymity },
                {
                    worker,
                    audit: useAuditStore.getState(),
                    onStatus: setStatus,
                    onProgress: runProgress.onProgress,
                },
                {
                    headers,
                    data: fullData,
                    metadata: parse?.metadata ?? [],
                    fileHash: parse?.fileHash,
                    streamed: parse?.streamed,
                }
            );
            setRunArtifacts(artifacts);
            setStatus('Done! Exported.');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setStatus(isCancelled(err) ? message : `Error: ${message}`);
        } finally {
            runProgress.reset();
            setIsProcessing(false);
        }
    };

    const handleDecrypt = async () => {
        if (!file || !fullData.length || !salt) return;
        if (parse?.streamed) {
            setStatus('Error: Decrypt is not available for files over 32 MiB in the browser; use the command-line tool.');
            return;
        }
        if (allRowsExcluded) {
            setStatus('All rows are excluded — nothing to export.');
            return;
        }
        setRunArtifacts([]);
        setIsProcessing(true);
        setStatus('Decrypting...');
        try {
            const worker = createWorker();
            const { decrypted: count, artifacts } = await finishDecryptRun(
                { file, dataset, excludedRows },
                { worker, audit: useAuditStore.getState(), onStatus: setStatus },
                {
                    headers,
                    data: fullData,
                    metadata: parse?.metadata ?? [],
                    fileHash: parse?.fileHash,
                }
            );
            setRunArtifacts(artifacts);
            setStatus(`Done! Decrypted ${count} cells.`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setStatus(`Error: ${message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const exportPolicy = () => {
        const blob = new Blob([JSON.stringify(exportPolicyDoc(headers, policies), null, 2)], {
            type: 'application/json',
        });
        useAdvancedSessionStore.getState().replacePolicyArtifacts([downloadBlob(blob, 'policy.json')]);
    };

    const importPolicy = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try {
            let doc: unknown;
            try {
                doc = JSON.parse(await f.text());
            } catch {
                throw new Error('this file is not valid JSON. Import a policy.json exported by this app or the command-line tool');
            }
            const applied = importPolicyDoc(doc, headers, (index, action, canon, params) => {
                useDatasetStore.getState().setPolicy(index, action);
                if (canon !== undefined) {
                    useDatasetStore.getState().setCanon(index, canon);
                }
                if (params !== undefined) {
                    useDatasetStore.getState().setParams(index, params);
                }
            });
            setStatus(`Policy imported (${applied} columns).`);
        } catch (err: unknown) {
            setStatus(`Error: Policy import failed: ${err instanceof Error ? err.message : 'unreadable file'}`);
        } finally {
            e.target.value = '';
        }
    };

    return (
        <div className="flex flex-col h-full gap-6">
            <DashboardCards
                file={file}
                onFileSelect={loadFile}
                status={status}
                artifacts={artifacts}
                policyArtifacts={policyArtifacts}
                passphrase={session.passphrase}
                setPassphrase={session.setPassphrase}
                keyStatus={session.keyStatus}
                onEnableKey={session.enable}
                onDisableKey={session.disable}
                isProcessing={isProcessing}
                onProcess={handleProcess}
                dataset={dataset}
                setDataset={setDataset}
                tokenEncoding={tokenEncoding}
                setTokenEncoding={setTokenEncoding}
                hasHeaders={headers.length > 0}
                onExportPolicy={exportPolicy}
                onImportPolicy={importPolicy}
                onDecrypt={handleDecrypt}
                processBlockedReason={processBlockedReason}
                onClear={() => {
                    useAdvancedSessionStore.getState().clearSession();
                    setSelectedCols(new Set());
                    void session.reset();
                    setDataset('');
                }}
            />

            <PseudonymisationNotice className="w-full" anonymity={passedAnonymity} />

            {headers.length > 0 && <BulkPolicyBar headers={headers} selected={selectedCols} />}
            {headers.length > 0 && <RoleSuggestBar />}

            <PolicyGrid
                headers={headers}
                rows={parse?.previewData ?? []}
                policies={policies}
                selected={selectedCols}
                onSelectionChange={setSelectedCols}
            />

            <AnonymityPanel streamed={parse?.streamed} />

            <RunProgress progress={runProgress.progress} onCancel={runProgress.cancel} />

            <RowExclusionPanel rows={fullData} streamed={parse?.streamed} />

            <AuditLogPanel />
        </div>
    );
};

export default AdvancedDashboard;
