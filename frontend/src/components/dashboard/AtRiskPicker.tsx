import type { ReactNode } from 'react';
import Explain from '../Explain';
import type { AtRiskRow } from '../../workers/anonymity-plan';
import type { AnonymityReport } from '../../types/anonymity';

const RISK_LIST_LIMIT = 200;

export interface AtRiskState {
    rows: AtRiskRow[];
    originals: number[];
}

const AtRiskPicker = ({
    report, streamed, busy, risk, picked, ignoreMsg, onLoad, onPickedChange, onIgnore,
}: {
    report: AnonymityReport;
    streamed: boolean;
    busy: boolean;
    risk: AtRiskState | null;
    picked: ReadonlySet<number>;
    ignoreMsg: string;
    onLoad: () => void;
    onPickedChange: (next: ReadonlySet<number>) => void;
    onIgnore: () => void;
}): ReactNode => {
    const riskFresh = risk;
    const fresh = { report };
    if (!(report.rows_below_k > 0 && !streamed)) return null;
    return (
                    <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-foreground">
                                {fresh.report.rows_below_k} row{fresh.report.rows_below_k === 1 ? '' : 's'} below k={fresh.report.k}.
                            </span>
                            <Explain k="anon.chooseRows">
                            <button
                                type="button"
                                onClick={onLoad}
                                disabled={busy}
                                className="px-2 py-1 rounded-sm border border-border text-foreground disabled:opacity-50"
                            >
                                Choose rows to ignore
                            </button>
                            </Explain>
                            <span className="text-muted">
                                Ignored rows are excluded from the output (the same exclusion as the Rows panel below).
                            </span>
                        </div>
                        {riskFresh && (
                            <div aria-label="At-risk rows" className="flex flex-col gap-2 text-xs">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Explain k="anon.selectAll">
                                    <button
                                        type="button"
                                        onClick={() => onPickedChange(new Set(riskFresh.rows.map((r) => riskFresh.originals[r.row])))}
                                        className="px-2 py-1 rounded-sm border border-border text-foreground"
                                    >
                                        Select all
                                    </button>
                                    </Explain>
                                    <Explain k="anon.clearSelection">
                                    <button
                                        type="button"
                                        onClick={() => onPickedChange(new Set())}
                                        disabled={picked.size === 0}
                                        className="px-2 py-1 rounded-sm border border-border text-foreground disabled:opacity-50"
                                    >
                                        Clear selection
                                    </button>
                                    </Explain>
                                    <Explain k="anon.ignore">
                                    <button
                                        type="button"
                                        onClick={onIgnore}
                                        disabled={picked.size === 0 || busy}
                                        className="px-2 py-1 rounded-sm bg-accent text-white disabled:opacity-50"
                                    >
                                        Ignore {picked.size} selected row{picked.size === 1 ? '' : 's'}
                                    </button>
                                    </Explain>
                                </div>
                                {picked.size >= fresh.report.rows && (
                                    <p role="alert" className="text-warning">
                                        Ignoring every remaining row would leave an empty file. Try the path to an anonymous release below instead.
                                    </p>
                                )}
                                <ul className="max-h-48 overflow-auto flex flex-col gap-1">
                                    {riskFresh.rows.slice(0, RISK_LIST_LIMIT).map((r) => {
                                        const orig = riskFresh.originals[r.row];
                                        return (
                                            <li key={orig}>
                                                <label className="flex items-center gap-2">
                                                    <Explain k="anon.ignoreRow">
                                                    <input
                                                        type="checkbox"
                                                        aria-label={`Ignore row ${orig + 1}`}
                                                        checked={picked.has(orig)}
                                                        onChange={() => {
                                                            const next = new Set(picked);
                                                            if (!next.delete(orig)) next.add(orig);
                                                            onPickedChange(next);
                                                        }}
                                                    />
                                                    </Explain>
                                                    <span className="text-muted">Row {orig + 1}: {r.values.join(' | ')}</span>
                                                </label>
                                            </li>
                                        );
                                    })}
                                </ul>
                                {riskFresh.rows.length > RISK_LIST_LIMIT && (
                                    <p className="text-muted">
                                        Showing the first {RISK_LIST_LIMIT} of {riskFresh.rows.length}; Select all covers every one.
                                    </p>
                                )}
                            </div>
                        )}
                        {ignoreMsg && <p role="status" className="text-xs text-foreground">{ignoreMsg}</p>}
                    </div>
    );
};

export default AtRiskPicker;
