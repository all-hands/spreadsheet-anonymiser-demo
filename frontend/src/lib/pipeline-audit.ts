import type { AuditSink } from './pipeline';
import { policyDetails } from './policy-params';
import type { ColumnPolicy } from '../types/policy';

export const recordColumns = (
    audit: Pick<AuditSink, 'addEntry'>,
    headers: string[],
    policies: Record<number, ColumnPolicy>,
    counts: Record<number, number>
): void => {
    headers.forEach((h, i) => {
        const p = policies[i];
        const details = policyDetails(p);
        audit.addEntry({
            columnIndex: i,
            columnName: h,
            operation: p?.type ?? 'keep',
            ...(p?.keying ? { keying: p.keying } : {}),
            rowsAffected: counts[i] ?? 0,
            ...(details ? { details } : {}),
        });
    });
};
