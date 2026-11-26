import type { Cell } from '../types/data';

export const EMPTY_CELL = '—';

export const CELL_FULL_MAX = 20;
export const CELL_EDGE = 10;

export interface CellDisplay {
    text: string;
    full: string;
    truncated: boolean;
}

export const displayCell = (cell: Cell | undefined): CellDisplay => {
    if (cell == null) return { text: EMPTY_CELL, full: EMPTY_CELL, truncated: false };
    const full = String(cell);
    if (full === '') return { text: EMPTY_CELL, full: '', truncated: false };
    const points = Array.from(full);
    if (points.length <= CELL_FULL_MAX) return { text: full, full, truncated: false };
    const text = `${points.slice(0, CELL_EDGE).join('')}…${points.slice(-CELL_EDGE).join('')}`;
    return { text, full, truncated: true };
};

export const CELL_WIDTH_REM = 14;
export const CELL_WIDTH_CLASS = 'w-56 min-w-56 max-w-56';
export const CELL_HEIGHT_CLASS = 'h-10';
