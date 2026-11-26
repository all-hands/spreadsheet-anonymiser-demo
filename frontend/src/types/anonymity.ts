export const SUPPRESS_MODES = ['cells', 'rows'] as const;
export type SuppressMode = (typeof SUPPRESS_MODES)[number];

export const MIN_K = 2;
export const MAX_K = 50;
export const DEFAULT_K = 5;
export const DEFAULT_SUPPRESS_MODE: SuppressMode = 'cells';

export interface ColumnContribution {
    column: number;
    rows_below_k_without: number;
    min_group_without: number;
}

export interface AnonymityReport {
    k: number;
    rows: number;
    groups: number;
    min_group: number;
    rows_below_k: number;
    satisfied: boolean;
    per_column: ColumnContribution[];
}

export interface SuppressionSummary {
    k: number;
    mode: SuppressMode;
    rows_in: number;
    rows_suppressed: number;
    cells_suppressed: number;
    rows_dropped: number;
    groups_before: number;
    min_group_before: number;
    groups_after: number;
    min_group_after: number;
}

export interface MeasureResult {
    report: AnonymityReport;
    claim: string;
}

export interface ReleaseCheck {
    before: AnonymityReport;
    report: AnonymityReport;
    claim: string;
    suppression: SuppressionSummary;
    passed: boolean;
}

export interface AnonymityAudit {
    k: number;
    mode: SuppressMode;
    quasiIdentifiers: string[];
    statement: string;
    claim: string;
    minGroup: number;
    rowsSuppressed: number;
    cellsSuppressed: number;
    rowsDropped: number;
}
