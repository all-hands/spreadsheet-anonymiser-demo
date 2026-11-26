import { headerNamesDirectIdentifier } from './roles';
import type { ColumnRole } from './roles';
import { policyLabel } from './policy-ui';
import type { ColumnPolicy } from '../types/policy';
import type { ColumnMetadata, ColumnType } from '../types/data';
import { MAX_K, MIN_K } from '../types/anonymity';
import type { AnonymityAudit, ReleaseCheck, SuppressMode } from '../types/anonymity';

export interface AnonymityRequest {
    qi: number[];
    identifiers: number[];
    k: number;
    mode: SuppressMode;
}

export const keepsRelinkability = (p: ColumnPolicy | undefined): boolean => {
    const t = p?.type ?? 'keep';
    if (t === 'hash') return p?.keying !== 'run';
    return t === 'faux' || t === 'encrypt' || t === 'kyber-aes' || t.startsWith('legacy-');
};

export const RELEASE_ALLOWED = ['keep', 'redact', 'mask', 'year', 'age-band', 'bucket'] as const;
export type ReleaseAllowed = (typeof RELEASE_ALLOWED)[number];

const RELEASE_ALLOWED_WORDS: Record<ReleaseAllowed, string> = {
    keep: 'keep',
    redact: 'redact',
    mask: 'mask',
    year: 'year',
    'age-band': 'age band',
    bucket: 'number range',
};

export const releaseAllowedProse = (): string => {
    const words = RELEASE_ALLOWED.map((t) => RELEASE_ALLOWED_WORDS[t]);
    return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
};

const releaseAllows = (p: ColumnPolicy | undefined): boolean => {
    const t = p?.type ?? 'keep';
    if (t === 'hash') return p?.keying === 'run';
    return (RELEASE_ALLOWED as readonly string[]).includes(t);
};

export const quasiIdentifiers = (roles: Record<number, ColumnRole>, count: number): number[] =>
    Array.from({ length: count }, (_, i) => i).filter((i) => roles[i] === 'quasi-identifier');

export const identifierColumns = (roles: Record<number, ColumnRole>, count: number): number[] =>
    Array.from({ length: count }, (_, i) => i).filter((i) => roles[i] === 'identifier');

export const DIRECT_TYPES: readonly ColumnType[] = ['email', 'phone', 'credit-card', 'ssn', 'url', 'ip'];

export const detectedIdentifierColumns = (metadata: readonly ColumnMetadata[]): number[] =>
    metadata
        .filter((m) => DIRECT_TYPES.includes(m.type) || headerNamesDirectIdentifier(m.header))
        .map((m) => m.index);

export const directIdentifierColumns = (
    roles: Record<number, ColumnRole>,
    count: number,
    metadata: readonly ColumnMetadata[]
): number[] => {
    const set = new Set([...identifierColumns(roles, count), ...detectedIdentifierColumns(metadata)]);
    return Array.from({ length: count }, (_, i) => i).filter((i) => set.has(i));
};

export const releaseProblems = (input: {
    headers: string[];
    policies: Record<number, ColumnPolicy>;
    request: AnonymityRequest;
    streamed?: boolean;
}): string[] => {
    const { headers, policies, request } = input;
    const problems: string[] = [];
    if (input.streamed) {
        problems.push(
            'This file is streamed (over 32 MiB), so the anonymity check cannot be measured in the browser. ' +
                'Use the command-line tool (--quasi-identifiers and --min-group).'
        );
    }
    if (!Number.isInteger(request.k) || request.k < MIN_K || request.k > MAX_K) {
        problems.push(`k must be a whole number from ${MIN_K} to ${MAX_K}.`);
    }
    if (request.qi.length === 0) {
        problems.push('Mark at least one column as a Quasi-identifier: there is nothing to measure without one.');
    }
    const relink = headers
        .map((_, i) => i)
        .filter((i) => keepsRelinkability(policies[i]));
    const notAllowed = headers
        .map((_, i) => i)
        .filter((i) => !keepsRelinkability(policies[i]) && !releaseAllows(policies[i]));
    if (notAllowed.length > 0) {
        const named = notAllowed
            .map((i) => `"${headers[i]}" (${policyLabel(policies[i]?.type ?? 'keep')})`)
            .join(', ');
        problems.push(
            `These columns use a policy an anonymous release does not allow: ${named}. ` +
                `An anonymous release allows only ${releaseAllowedProse()}.`
        );
    }
    if (relink.length > 0) {
        const named = relink
            .map((i) => `"${headers[i]}" (${policyLabel(policies[i]?.type ?? 'keep')})`)
            .join(', ');
        problems.push(
            `These columns keep a link back to people or between releases: ${named}. ` +
                `An anonymous release allows only ${releaseAllowedProse()}.`
        );
    }
    const keptIds = request.identifiers.filter((i) => (policies[i]?.type ?? 'keep') !== 'redact');
    if (keptIds.length > 0) {
        const named = keptIds.map((i) => `"${headers[i] ?? i}" (${policyLabel(policies[i]?.type ?? 'keep')})`).join(', ');
        problems.push(
            `Direct identifier columns must be redacted: ${named}. Redact them (an anonymous release keeps no name, email, phone or ID).`
        );
    }
    return problems;
};

export const anonymityStatement = (k: number, mode: SuppressMode): string =>
    mode === 'cells'
        ? `k-anonymity k=${k} measured, local suppression applied`
        : `k-anonymity k=${k} measured, record suppression applied`;

export const anonymityAudit = (
    request: Pick<AnonymityRequest, 'k' | 'mode'>,
    names: string[],
    check: ReleaseCheck
): AnonymityAudit => ({
    k: request.k,
    mode: request.mode,
    quasiIdentifiers: names,
    statement: anonymityStatement(request.k, request.mode),
    claim: check.claim,
    minGroup: check.report.min_group,
    rowsSuppressed: check.suppression.rows_suppressed,
    cellsSuppressed: check.suppression.cells_suppressed,
    rowsDropped: check.suppression.rows_dropped,
});

export class AnonymityBlockedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AnonymityBlockedError';
    }
}

export const blockedMessage = (check: ReleaseCheck, names: string[], worst: string[]): string =>
    `Export blocked: the anonymity check did not pass on ${names.join(', ')} ` +
    `(${check.report.rows === 0 ? 'no row is left once small groups are suppressed' : check.claim}). ` +
    (worst.length ? `Generalise further: ${worst.join(', ')}.` : 'Generalise the quasi-identifiers further, lower k, or mark fewer columns.');

export const rankedOffenders = <T extends { column: number; rows_below_k_without: number }>(
    report: { per_column: T[] },
    headers: readonly string[]
): { name: string; entry: T }[] =>
    [...report.per_column]
        .sort((a, b) => a.rows_below_k_without - b.rows_below_k_without || a.column - b.column)
        .map((entry) => ({ name: headers[entry.column], entry }))
        .filter((o): o is { name: string; entry: T } => o.name !== undefined);

export const worstOffenders = (
    report: { per_column: { column: number; rows_below_k_without: number }[] },
    headers: readonly string[]
): string[] => rankedOffenders(report, headers).map((o) => o.name);
