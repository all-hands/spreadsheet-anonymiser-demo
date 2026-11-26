import { DIRECT_TYPES } from '../../lib/anonymity';
import { isNumericColumn, suggestRole, suggestedPolicyForRole } from '../../lib/roles';
import type { ColumnMetadata, RowData } from '../../types/data';
import { BASIC_POLICY_TYPES, HASH_RUN_CHOICE } from '../../types/policy';
import type { ColumnPolicy, PolicyType } from '../../types/policy';

export const choiceOf = (policy: ColumnPolicy | undefined): string =>
    policy?.type === 'hash' && policy.keying === 'run' ? HASH_RUN_CHOICE : (policy?.type ?? 'keep');

export const policyOfChoice = (choice: string): ColumnPolicy =>
    choice === HASH_RUN_CHOICE ? { type: 'hash', keying: 'run' } : { type: choice as PolicyType };

const YEAR_FIRST = /^\d{4}[-/.]\d{2}[-/.]\d{2}/;

const columnCells = (rows: readonly RowData[], index: number): string[] =>
    rows
        .map((r) => r[index])
        .filter((c) => c !== null && c !== undefined && String(c).trim() !== '')
        .map((c) => String(c).trim());

export const seedChooserPolicies = (
    metadata: ColumnMetadata[],
    rows: readonly RowData[] = []
): Record<number, ColumnPolicy> => {
    const policies: Record<number, ColumnPolicy> = {};
    metadata.forEach((m) => {
        const role = suggestRole(m.header, m.type);
        let policy: ColumnPolicy;
        if (m.type === 'date' && role !== 'identifier') {
            const cells = columnCells(rows, m.index);
            policy = cells.every((c) => YEAR_FIRST.test(c)) ? { type: 'year' } : { type: 'redact' };
        } else {
            policy = suggestedPolicyForRole(role, m.type, isNumericColumn(rows, m.index));
        }
        if (!BASIC_POLICY_TYPES.includes(policy.type)) policy = { type: 'keep' };
        if (policy.type === 'keep' && DIRECT_TYPES.includes(m.type)) policy = { type: 'mask' };
        policies[m.index] = policy;
    });
    return policies;
};
