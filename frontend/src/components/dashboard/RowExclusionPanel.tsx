import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDatasetStore } from '../../store/datasetStore';
import type { RowData } from '../../types/data';
import { clsx } from 'clsx';
import DualScrollArea from '../DualScrollArea';
import Explain from '../Explain';
import CellText from '../CellText';
import { CELL_WIDTH_CLASS, CELL_WIDTH_REM, CELL_HEIGHT_CLASS } from '../../lib/cell-display';

const ROW_HEIGHT_PX = 40;
const LEAD_REM = 6;

interface RowExclusionPanelProps {
    rows: RowData[];
    streamed?: boolean;
}

const RowExclusionPanel = ({ rows, streamed = false }: RowExclusionPanelProps) => {
    const { excludedRows, toggleRowExclusion, clearRowExclusions } = useDatasetStore();
    const parentRef = useRef<HTMLDivElement>(null);

    // eslint-disable-next-line react-hooks/incompatible-library
    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ROW_HEIGHT_PX,
        overscan: 8,
    });

    const columns = rows.reduce((n, r) => Math.max(n, r.length), 0);
    const rowWidthRem = LEAD_REM + columns * CELL_WIDTH_REM;

    if (streamed) {
        return (
            <div
                role="note"
                className="rounded-xl border border-border bg-surface p-6 text-center text-muted"
            >
                Row exclusion is unavailable for large files: this file is streamed in chunks on
                export (only a {rows.length}-row preview is loaded), so every row is exported.
                Remove unwanted rows from the source file, or use the command-line tool.
            </div>
        );
    }

    if (rows.length === 0) {
        return (
            <div className="rounded-xl border border-border bg-surface p-12 text-center text-muted">
                Load a file to exclude rows.
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-border bg-surface flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <Explain k="rows.title">
                <h3 className="text-sm font-semibold text-foreground">
                    Rows
                    <span className="ml-2 font-normal text-muted">
                        {rows.length - excludedRows.size} of {rows.length} will be exported
                    </span>
                </h3>
                </Explain>
                <Explain k="rows.clear">
                <button
                    type="button"
                    onClick={clearRowExclusions}
                    disabled={excludedRows.size === 0}
                    className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-xs text-foreground hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Clear exclusions
                </button>
                </Explain>
            </div>
            <DualScrollArea scrollerRef={parentRef} scrollerClassName="h-[400px]" label="Rows to exclude" explain="rows.region">
                <div
                    style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        width: `calc(${rowWidthRem}rem)`,
                        position: 'relative',
                    }}
                >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const i = virtualRow.index;
                        const row = rows[i];
                        return (
                            <div
                                key={i}
                                className={clsx(
                                    'flex items-center absolute left-0 w-full border-b border-border transition-colors',
                                    CELL_HEIGHT_CLASS,
                                    excludedRows.has(i) && 'opacity-50'
                                )}
                                style={{ transform: `translateY(${virtualRow.start}px)` }}
                            >
                                <div className="flex w-24 min-w-24 max-w-24 shrink-0 items-center gap-2 px-3">
                                    <Explain k="rows.exclude">
                                    <input
                                        type="checkbox"
                                        aria-label={`Exclude row ${i + 1}`}
                                        checked={excludedRows.has(i)}
                                        onChange={() => toggleRowExclusion(i)}
                                        className="shrink-0"
                                    />
                                    </Explain>
                                    <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                                        {i + 1}
                                    </span>
                                </div>
                                {row.map((cell, cIdx) => (
                                    <div
                                        key={cIdx}
                                        className={clsx(CELL_WIDTH_CLASS, 'shrink-0 overflow-hidden px-3 text-sm text-muted')}
                                    >
                                        <CellText value={cell} />
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>
            </DualScrollArea>
        </div>
    );
};

export default RowExclusionPanel;
