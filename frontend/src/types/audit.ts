import type { PolicyType } from './policy';
import type { AnonymityAudit } from './anonymity';

export interface AuditLogEntry {
    id: string;
    timestamp: number;
    columnIndex: number;
    columnName: string;
    operation: PolicyType;
    keying?: 'run';
    rowsAffected: number;
    details?: string;
}

export interface AuditLog {
    id: string;
    createdAt: number;
    completedAt?: number;
    filename: string;
    fileSize: number;
    fileHash?: string;
    totalRows: number;
    totalColumns: number;
    entries: AuditLogEntry[];
    status: 'pending' | 'processing' | 'completed' | 'failed';
    errorMessage?: string;
    anonymity?: AnonymityAudit;
}

export interface AuditSummary {
    byOperation: Partial<Record<PolicyType, number>>;
    totalTransformations: number;
}

export const columnsOf = (summary: AuditSummary, op: PolicyType): number =>
    summary.byOperation[op] ?? 0;

export const generateAuditSummary = (log: AuditLog): AuditSummary => {
    const summary: AuditSummary = {
        byOperation: {},
        totalTransformations: 0,
    };

    for (const entry of log.entries) {
        summary.byOperation[entry.operation] = (summary.byOperation[entry.operation] ?? 0) + 1;
        if (entry.operation !== 'keep') {
            summary.totalTransformations += entry.rowsAffected;
        }
    }

    return summary;
};
