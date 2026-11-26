import type { RowData } from './worker-client';
import type { RunDeps, RunInput } from './pipeline';
import { tableFormatOf } from './table-format';
import type { ColumnMetadata } from '../types/data';
import { KEYED_SESSION_REQUIRED } from '../types/policy';
import type { AnonymizeOpts, ColumnPolicy } from '../types/policy';

export const defaultPolicies = (metadata: ColumnMetadata[]): Record<number, ColumnPolicy> => {
    const policies: Record<number, ColumnPolicy> = {};
    metadata
        .filter((m) => m.type !== 'text')
        .forEach((m) => {
            policies[m.index] = { type: 'mask' };
        });
    return policies;
};

export interface ParsedDataset {
    headers: string[];
    data: RowData[];
    metadata: ColumnMetadata[];
    fileHash?: string;
    streamed?: boolean;
}

export type RowExclusions = ReadonlySet<number>;

export const filterRows = (parse: ParsedDataset, excluded?: RowExclusions): ParsedDataset =>
    !excluded || excluded.size === 0
        ? parse
        : { ...parse, data: parse.data.filter((_, i) => !excluded.has(i)) };

export const announceExclusions = (
    deps: RunDeps, excluded: RowExclusions | undefined, totalRows: number
): void => {
    if (excluded?.size) deps.onStatus(`Excluding ${excluded.size} of ${totalRows} rows.`);
};

export const optsOf = (input: Pick<RunInput, 'dataset' | 'tokenEncoding'>): AnonymizeOpts => ({
    dataset: input.dataset?.trim() || undefined,
    tokenEncoding: input.tokenEncoding,
});

export const generateOutput = async (
    deps: RunDeps,
    headers: string[],
    data: RowData[],
    file: { name: string }
): Promise<Blob> => {
    deps.onStatus('Generating file...');
    return deps.worker.generateFile(headers, data, tableFormatOf(file.name));
};

export const keyedSessionProblem = (
    policies: Record<number, ColumnPolicy> | undefined,
    salt: Uint8Array | null | undefined
): string | null =>
    !salt && policies && Object.values(policies).some((p) => p.type === 'encrypt')
        ? KEYED_SESSION_REQUIRED
        : null;

export const gateDeps = (deps: RunDeps): { deps: RunDeps; close: () => void } => {
    let open = true;
    return {
        deps: {
            ...deps,
            onStatus: (msg) => {
                if (open) deps.onStatus(msg);
            },
            onProgress: deps.onProgress
                ? (p) => {
                      if (open) deps.onProgress?.(p);
                  }
                : undefined,
        },
        close: () => {
            open = false;
        },
    };
};
