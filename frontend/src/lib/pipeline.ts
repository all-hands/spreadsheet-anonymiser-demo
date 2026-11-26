import type { ParseResult, StreamProgress, WorkerApi } from './worker-client';
import type { ColumnPolicy, TokenEncoding } from '../types/policy';
import type { AuditLog, AuditLogEntry } from '../types/audit';
import { downloadBlob } from './download';
import { recordColumns } from './pipeline-audit';
import {
    announceExclusions,
    defaultPolicies,
    filterRows,
    gateDeps,
    generateOutput,
    keyedSessionProblem,
    optsOf,
} from './pipeline-common';
export { defaultPolicies, filterRows, optsOf } from './pipeline-common';
export type { ParsedDataset, RowExclusions } from './pipeline-common';
import type { ParsedDataset, RowExclusions } from './pipeline-common';
import type { Artifact } from './download';
import { supportingArtifacts } from './pipeline-artifacts';
import { runStreamedExport } from './pipeline-stream';
import {
    AnonymityBlockedError,
    anonymityAudit,
    blockedMessage,
    releaseProblems,
    detectedIdentifierColumns,
    worstOffenders,
} from './anonymity';
import type { AnonymityRequest } from './anonymity';
import type { AnonymityAudit } from '../types/anonymity';

export interface AuditSink {
    startNewLog: (
        filename: string,
        fileSize: number,
        totalRows: number,
        totalColumns: number,
        fileHash?: string
    ) => string;
    addEntry: (entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) => void;
    setAnonymity?: (anonymity: AnonymityAudit) => void;
    completeLog: () => void;
    failLog: (errorMessage: string) => void;
    getLog: () => AuditLog | null;
}

export interface RunInput {
    file: File;
    policies?: Record<number, ColumnPolicy>;
    dataset?: string;
    tokenEncoding?: TokenEncoding;
    salt?: Uint8Array | null;
    excludedRows?: RowExclusions;
    anonymity?: AnonymityRequest;
}

export interface RunDeps {
    worker: Pick<WorkerApi, 'parseFile' | 'anonymizeData' | 'decryptData' | 'generateFile'> &
        Partial<Pick<WorkerApi, 'streamAnonymize' | 'suppressForRelease'>>;
    audit: AuditSink;
    onStatus: (msg: string) => void;
    onProgress?: (p: StreamProgress) => void;
}

export interface RunResult {
    parse: ParseResult;
    counts: Record<number, number>;
    artifacts: Artifact[];
}

export interface DecryptInput {
    file: File;
    dataset?: string;
    excludedRows?: RowExclusions;
}

export const finishRun = async (
    input: RunInput,
    deps: RunDeps,
    parse: ParsedDataset
): Promise<{ counts: Record<number, number>; artifacts: Artifact[] }> => {
    const gate = gateDeps(deps);
    try {
        return await finishRunInner(input, gate.deps, parse);
    } finally {
        gate.close();
    }
};

const finishRunInner = async (
    input: RunInput,
    deps: RunDeps,
    parse: ParsedDataset
): Promise<{ counts: Record<number, number>; artifacts: Artifact[] }> => {
    const keyed = input.anonymity ? null : keyedSessionProblem(input.policies, input.salt);
    if (keyed) throw new Error(keyed);
    if (input.anonymity) {
        const problems = releaseProblems({
            headers: parse.headers,
            policies: input.policies ?? defaultPolicies(parse.metadata),
            request: {
                ...input.anonymity,
                identifiers: [...new Set([...input.anonymity.identifiers, ...detectedIdentifierColumns(parse.metadata)])],
            },
            streamed: parse.streamed,
        });
        if (problems.length) throw new AnonymityBlockedError(`Export blocked: ${problems.join(' ')}`);
    }
    try {
        const policies = input.policies ?? defaultPolicies(parse.metadata);
        if (!input.policies) {
            deps.onStatus(
                `Found ${Object.keys(policies).length} sensitive columns. Anonymising...`
            );
        }

        if (parse.streamed) {
            const r = await runStreamedExport(input, deps, parse, policies, optsOf(input));
            return {
                counts: r.counts,
                artifacts: [
                    ...(r.blob ? [downloadBlob(r.blob, `anonymized-${input.file.name}`)] : []),
                    ...supportingArtifacts(input, deps.audit),
                ],
            };
        }

        const exportable = filterRows(parse, input.excludedRows);
        announceExclusions(deps, input.excludedRows, parse.data.length);

        const audit = deps.audit;
        audit.startNewLog(
            input.file.name,
            input.file.size,
            parse.data.length,
            parse.headers.length,
            parse.fileHash
        );

        const { data: anonymized, counts } = await deps.worker.anonymizeData(
            exportable.data,
            exportable.headers,
            exportable.metadata,
            policies,
            (msg: string) => deps.onStatus(msg),
            optsOf(input)
        );

        let released = anonymized;
        if (input.anonymity) {
            const req = input.anonymity;
            if (!deps.worker.suppressForRelease) throw new Error('This worker cannot suppress.');
            deps.onStatus(`Suppressing groups smaller than k=${req.k}...`);
            const r = await deps.worker.suppressForRelease(
                anonymized,
                exportable.headers,
                req.qi,
                req.k,
                req.mode
            );
            const names = req.qi.map((i) => exportable.headers[i]);
            if (!r.check.passed) {
                throw new AnonymityBlockedError(
                    blockedMessage(r.check, names, worstOffenders(r.check.before, exportable.headers))
                );
            }
            released = r.data;
            audit.setAnonymity?.(anonymityAudit(req, names, r.check));
        }

        recordColumns(audit, parse.headers, policies, counts);

        const blob = await generateOutput(deps, exportable.headers, released, input.file);

        audit.completeLog();

        const artifacts = [
            downloadBlob(blob, `anonymized-${input.file.name}`),
            ...supportingArtifacts(input.anonymity ? { ...input, salt: null } : input, audit),
        ];
        return { counts, artifacts };
    } catch (err: unknown) {
        // INVARIANT: a failed run must never leave a completed, certificate-eligible log
        // for an output that does not exist. No-op when nothing was started.
        deps.audit.failLog(err instanceof Error ? err.message : 'Unknown error');
        throw err;
    }
};

export const finishDecryptRun = async (
    input: DecryptInput,
    deps: RunDeps,
    parse: ParsedDataset
): Promise<{ decrypted: number; artifacts: Artifact[] }> => {
    const gate = gateDeps(deps);
    try {
        return await finishDecryptRunInner(input, gate.deps, parse);
    } finally {
        gate.close();
    }
};

const finishDecryptRunInner = async (
    input: DecryptInput,
    deps: RunDeps,
    parse: ParsedDataset
): Promise<{ decrypted: number; artifacts: Artifact[] }> => {
    const exportable = filterRows(parse, input.excludedRows);
    announceExclusions(deps, input.excludedRows, parse.data.length);

    const { data: decrypted, decrypted: count } = await deps.worker.decryptData(
        exportable.data,
        exportable.headers,
        (msg: string) => deps.onStatus(msg),
        optsOf(input)
    );

    const blob = await generateOutput(deps, exportable.headers, decrypted, input.file);

    return {
        decrypted: count,
        artifacts: [downloadBlob(blob, `decrypted-${input.file.name}`)],
    };
};

export const runPipeline = async (input: RunInput, deps: RunDeps): Promise<RunResult> => {
    const parse = await deps.worker.parseFile(
        input.file,
        (msg: string) => deps.onStatus(msg)
    );
    const { counts, artifacts } = await finishRun(input, deps, parse);
    return { parse, counts, artifacts };
};
