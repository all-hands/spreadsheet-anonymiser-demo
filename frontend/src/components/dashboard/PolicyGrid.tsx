import PolicySelector from '../PolicySelector';
import RoleSelector from '../RoleSelector';
import type { RowData } from '../../types/data';
import type { ColumnPolicy } from '../../types/policy';
import { policyTint } from '../../lib/policy-ui';
import { clsx } from 'clsx';
import DualScrollArea from '../DualScrollArea';
import Explain from '../Explain';
import { useDatasetStore } from '../../store/datasetStore';
import { useAdvancedSessionStore } from '../../store/advancedSessionStore';
import { usePolicyPreview } from '../../hooks/usePolicyPreview';
import CellText from '../CellText';
import { generalisationFallbacks } from '../../lib/preview-hints';
import { CELL_WIDTH_REM, CELL_HEIGHT_CLASS } from '../../lib/cell-display';

interface PolicyGridProps {
    headers: string[];
    rows: RowData[];
    policies: Record<number, ColumnPolicy>;
    selected?: ReadonlySet<number>;
    onSelectionChange?: (next: Set<number>) => void;
}

const PolicyGrid = ({ headers, rows, policies, selected, onSelectionChange }: PolicyGridProps) => {
    const { metadata, dataset, tokenEncoding } = useDatasetStore();
    const keyStatus = useAdvancedSessionStore((s) => s.keyStatus);
    const preview = usePolicyPreview(rows, headers, metadata, policies, dataset, tokenEncoding, keyStatus);
    const hints =
        preview.transformed && !preview.pending ? generalisationFallbacks(rows, preview.rows, policies) : {};
    const anyHint = Object.keys(hints).length > 0;
    const selectable = selected !== undefined && onSelectionChange !== undefined;
    const toggle = (idx: number) => {
        if (!selectable) return;
        const next = new Set(selected);
        if (!next.delete(idx)) next.add(idx);
        onSelectionChange(next);
    };
    return (
    <div className="flex-1 overflow-hidden rounded-xl border border-border bg-surface flex flex-col">
        {selectable && headers.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border text-xs text-muted">
                <Explain k="grid.count"><span>{selected.size} of {headers.length} selected</span></Explain>
                <Explain k="grid.selectAll">
                    <button type="button" className="underline" onClick={() => onSelectionChange(new Set(headers.map((_, i) => i)))}>
                        Select all
                    </button>
                </Explain>
                <Explain k="grid.clear">
                    <button type="button" className="underline" onClick={() => onSelectionChange(new Set())}>
                        Clear
                    </button>
                </Explain>
            </div>
        )}
        {(preview.transformed || preview.pending || preview.error) && (
            <Explain k="grid.preview">
            <div className="px-4 py-1 border-b border-border text-xs text-muted" role="status" data-testid="grid-preview-status">
                {preview.error
                    ? `Preview failed: ${preview.error}`
                    : preview.pending
                      ? 'Updating preview…'
                      : preview.lockedColumns.length > 0
                        ? 'Showing the anonymised preview. Encrypt needs a key: enter a passphrase in Keyed hashing and click the key button.'
                        : 'Showing the anonymised preview of the policies below.'}
            </div>
            </Explain>
        )}
        <DualScrollArea className="flex-1" scrollerClassName="max-h-[32rem]" label="Policy grid" explain="grid.region">
            <table
                className="table-fixed text-left text-sm whitespace-nowrap"
                style={{ width: `${Math.max(headers.length, 1) * CELL_WIDTH_REM}rem` }}
            >
                <colgroup>
                    {headers.map((_, idx) => (
                        <col key={idx} style={{ width: `${CELL_WIDTH_REM}rem` }} />
                    ))}
                </colgroup>
                <thead className="bg-surface sticky top-0 z-10 shadow-xs">
                    <tr>
                        {headers.map((header, idx) => (
                            <th key={idx} className="p-3 border-b border-border align-top font-normal">
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center justify-between gap-2 text-foreground font-medium">
                                        <span className="flex min-w-0 items-center gap-2" title={header}>
                                            {selectable && (
                                                <Explain k="grid.selectColumn">
                                                <input
                                                    type="checkbox"
                                                    checked={selected.has(idx)}
                                                    onChange={() => toggle(idx)}
                                                    aria-label={`Select column "${header}"`}
                                                />
                                                </Explain>
                                            )}
                                            <span className="truncate">{header}</span>
                                        </span>
                                        <Explain k="col.index"><span className="shrink-0 text-[10px] bg-surface-2 px-1.5 py-0.5 rounded-sm text-muted">{idx}</span></Explain>
                                    </div>
                                    <RoleSelector colIndex={idx} header={header} />
                                    <PolicySelector colIndex={idx} header={header} />
                                    {anyHint && (
                                        <div className="h-8 overflow-hidden text-[10px] leading-4 text-warning whitespace-normal" data-testid="fallback-hint-slot">
                                            {hints[idx] && <span title={hints[idx]}>{hints[idx]}</span>}
                                        </div>
                                    )}
                                </div>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {preview.rows.map((row, rIdx) => (
                        <tr key={rIdx} className={clsx("transition-colors", preview.pending && "opacity-60")}>
                            {row.map((cell, cIdx) => (
                                <td key={cIdx} className={clsx(
                                    CELL_HEIGHT_CLASS,
                                    "px-3 overflow-hidden border-r last:border-0 text-muted",
                                    policyTint(policies[cIdx]?.type ?? ''),
                                )}>
                                    <CellText value={cell} />
                                </td>
                            ))}
                        </tr>
                    ))}
                    {rows.length === 0 && (
                        <tr>
                            <td colSpan={headers.length || 1} className="p-12 text-center text-muted">
                                No data loaded. Upload a file to start.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </DualScrollArea>
    </div>
    );
};

export default PolicyGrid;
