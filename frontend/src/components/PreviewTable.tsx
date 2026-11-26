import Explain from './Explain';
import { useRef, useCallback } from 'react';
import type { Ref, UIEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { RowData, ColumnMetadata } from '../types/data';
import { PREVIEW_ROW_LIMIT } from '../lib/constants';
import { clsx } from 'clsx';
import DualScrollArea from './DualScrollArea';
import { assignRef } from '../lib/scroll-link';
import CellText from './CellText';
import { CELL_WIDTH_CLASS, CELL_WIDTH_REM, CELL_HEIGHT_CLASS } from '../lib/cell-display';

interface PreviewTableProps {
    headers: string[];
    data: RowData[];
    metadata: ColumnMetadata[];
    highlightColumns?: number[];
    className?: string;
    scrollerRef?: Ref<HTMLDivElement>;
    onScroll?: (e: UIEvent<HTMLDivElement>) => void;
    label?: string;
    totalRows?: number;
}

export const PreviewTable = ({
    headers,
    data,
    metadata,
    highlightColumns = [],
    className,
    scrollerRef,
    onScroll,
    label,
    totalRows,
}: PreviewTableProps) => {
    const parentRef = useRef<HTMLDivElement | null>(null);
    const setScroller = useCallback((el: HTMLDivElement | null) => {
        parentRef.current = el;
        assignRef(scrollerRef, el);
    }, [scrollerRef]);

    // eslint-disable-next-line react-hooks/incompatible-library
    const rowVirtualizer = useVirtualizer({
        count: data.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 40,
        overscan: 5,
    });

    const getColumnType = (index: number): string => {
        const col = metadata.find(m => m.index === index);
        return col?.type || 'text';
    };

    const isHighlighted = (colIndex: number): boolean => {
        return highlightColumns.includes(colIndex);
    };

    const totalWidth = `${headers.length * CELL_WIDTH_REM}rem`;
    const cellBase = clsx(CELL_WIDTH_CLASS, 'shrink-0 box-border px-3 border-r border-border last:border-r-0');

    return (
        <div className={clsx("flex flex-col border border-border rounded-lg overflow-hidden", className)}>
            <DualScrollArea
                className="flex-1"
                scrollerClassName="h-[60vh]"
                scrollerRef={setScroller}
                onScroll={onScroll}
                label={label}
                explain="preview.region"
            >
                <div style={{ width: totalWidth }}>
                    <div className="flex bg-surface-2 border-b border-border sticky top-0 z-10" style={{ width: totalWidth }}>
                        {headers.map((header, idx) => (
                            <Explain key={idx} k="preview.column">
                            <div
                                title={header}
                                className={clsx(
                                    cellBase,
                                    "py-2 font-semibold text-sm h-12 overflow-hidden",
                                    isHighlighted(idx) && "bg-info/20 text-info"
                                )}
                            >
                                <div className="truncate">{header}</div>
                                <div className="text-[10px] text-muted uppercase truncate">{getColumnType(idx)}</div>
                            </div>
                            </Explain>
                        ))}
                    </div>

                    <div
                        style={{
                            height: `${rowVirtualizer.getTotalSize()}px`,
                            width: totalWidth,
                            position: 'relative',
                        }}
                    >
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                            const row = data[virtualRow.index];
                            return (
                                <div
                                    key={virtualRow.index}
                                    className="flex absolute left-0 border-b border-border hover:bg-surface-hover"
                                    style={{
                                        width: totalWidth,
                                        height: `${virtualRow.size}px`,
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                >
                                    {headers.map((_, colIdx) => (
                                        <div
                                            key={colIdx}
                                            className={clsx(
                                                cellBase,
                                                CELL_HEIGHT_CLASS,
                                                "flex items-center text-sm overflow-hidden",
                                                isHighlighted(colIdx) && "bg-info/10"
                                            )}
                                        >
                                            <div className="min-w-0 flex-1"><CellText value={row[colIdx]} /></div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </DualScrollArea>

            <div className="px-3 py-2 bg-surface-2 border-t border-border text-xs text-muted">
                Showing {Math.min(PREVIEW_ROW_LIMIT, data.length)} of {Math.max(totalRows ?? 0, data.length)} rows
            </div>
        </div>
    );
};

export default PreviewTable;
