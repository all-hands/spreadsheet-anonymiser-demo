export type Cell = string | number | boolean | null;
export type Rows = Cell[][];
export type RowData = Cell[];

export type ColumnType = 'text' | 'email' | 'phone' | 'date' | 'credit-card' | 'ssn' | 'url' | 'ip';

export interface ColumnMetadata {
    index: number;
    header: string;
    type: ColumnType;
    confidence: number;
}

export interface ParseResult {
    headers: string[];
    data: Rows;
    metadata: ColumnMetadata[];
    fileHash: string;
    streamed?: boolean;
}

export interface StreamProgress {
    bytes: number;
    total: number;
    rows: number;
}

export interface StreamResult {
    counts: Record<number, number>;
    totalRows: number;
    fileHash: string;
    blob: Blob | null;
}

export interface AnonymizeResult {
    data: Rows;
    counts: Record<number, number>;
}
