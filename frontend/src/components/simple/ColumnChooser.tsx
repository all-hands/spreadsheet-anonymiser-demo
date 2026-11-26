import { useState } from 'react';
import { Link } from 'react-router-dom';
import BasicPolicySelect from './BasicPolicySelect';
import Explain from '../Explain';
import { retype } from '../../lib/policy-params';
import { displayCell } from '../../lib/cell-display';
import { seedChooserPolicies } from './chooser-policies';
import type { ColumnMetadata, RowData, Cell } from '../../types/data';
import type { ColumnPolicy } from '../../types/policy';

const SAMPLE_ROWS = 3;

interface ColumnChooserProps {
    headers: string[];
    metadata: ColumnMetadata[];
    rows: RowData[];
    onRun: (policies: Record<number, ColumnPolicy>) => void;
    disabled?: boolean;
}

const sampleCell = (cell: Cell | undefined): string => displayCell(cell).text;

const sampleValues = (rows: RowData[], colIndex: number): string =>
    rows
        .slice(0, SAMPLE_ROWS)
        .map((row) => sampleCell(row[colIndex]))
        .join(', ');

const sampleTitle = (rows: RowData[], colIndex: number): string =>
    rows
        .slice(0, SAMPLE_ROWS)
        .map((row) => displayCell(row[colIndex]).full || '—')
        .join(', ');

const ColumnChooser = ({ headers, metadata, rows, onRun, disabled = false }: ColumnChooserProps) => {
    const [policies, setPolicies] = useState(() => seedChooserPolicies(metadata, rows));

    const setColumn = (colIndex: number, policy: ColumnPolicy) => {
        const next = retype(policy.type);
        if (policy.keying) next.keying = policy.keying;
        setPolicies((prev) => ({ ...prev, [colIndex]: next }));
    };

    const transformed = Object.values(policies).filter((p) => p.type !== 'keep').length;
    const anyHash = Object.values(policies).some((p) => p.type === 'hash' && p.keying !== 'run');
    const anyKeyedRun = Object.values(policies).some((p) => p.type === 'hash' && p.keying === 'run');
    const bandRef = Object.values(policies).find((p) => p.type === 'age-band')?.referenceDate;

    return (
        <div className="rounded-xl border border-border bg-surface flex flex-col">
            <div className="overflow-auto">
                <table className="table-fixed w-full min-w-[44rem] text-left text-sm whitespace-nowrap">
                    <thead className="bg-surface sticky top-0 z-10 shadow-xs">
                        <tr className="text-muted">
                            <th className="p-3 border-b border-border font-medium w-44"><Explain k="col.column"><span>Column</span></Explain></th>
                            <th className="p-3 border-b border-border font-medium w-28"><Explain k="col.type"><span>Detected type</span></Explain></th>
                            <th className="p-3 border-b border-border font-medium"><Explain k="col.samples"><span>Sample values</span></Explain></th>
                            <th className="p-3 border-b border-border font-medium w-52"><Explain k="col.policy"><span>Anonymisation</span></Explain></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {headers.map((header, i) => (
                            <tr key={i} className="transition-colors">
                                <td className="p-3 border-r text-foreground overflow-hidden">
                                    <span className="flex items-center gap-2" title={header}>
                                        <span className="truncate">{header}</span>
                                        <span className="text-[10px] bg-surface-2 px-1.5 py-0.5 rounded-sm text-muted">
                                            {i}
                                        </span>
                                    </span>
                                </td>
                                <td className="p-3 border-r text-muted">
                                    {metadata[i]?.type ?? 'text'}
                                </td>
                                <td
                                    className="p-3 border-r text-muted truncate"
                                    title={sampleTitle(rows, i)}
                                >
                                    {sampleValues(rows, i)}
                                </td>
                                <td className="p-3">
                                    <BasicPolicySelect
                                        value={policies[i] ?? { type: 'keep' }}
                                        colIndex={i}
                                        onChange={setColumn}
                                        ariaLabel={`Anonymisation for ${header}`}
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {anyKeyedRun && (
                <p
                    role="note"
                    aria-label="Keyed per-run hash note"
                    className="mx-3 mt-3 rounded-lg border border-border bg-surface-2 p-3 text-sm text-foreground"
                >
                    <strong>Keyed hash, this run only:</strong> tokens come from a random secret made for this run
                    and discarded afterwards. They cannot be reversed or guessed, and they will{' '}
                    <strong>not</strong> match tokens from any other run or file. For tokens that stay joinable
                    across runs, use{' '}
                    <Explain k="nav.advanced"><Link to="/advanced" className="underline text-accent hover:text-accent-hover">
                        Advanced mode
                    </Link></Explain>{' '}
                    with a passphrase.
                </p>
            )}
            {anyHash && (
                <p
                    role="note"
                    aria-label="Unkeyed hash warning"
                    className="mx-3 mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground"
                >
                    <strong className="text-warning">Unkeyed hash:</strong> values that can be guessed (IDs, names,
                    short codes) can be recovered by hashing guesses. For real pseudonymisation use{' '}
                    <Explain k="nav.advanced"><Link to="/advanced" className="underline text-accent hover:text-accent-hover">
                        Advanced mode
                    </Link></Explain>{' '}
                    with a passphrase.
                </p>
            )}
            {bandRef && (
                <p
                    role="note"
                    aria-label="Age band reference date"
                    className="mx-3 mt-3 rounded-lg border border-border bg-surface-2 p-3 text-sm text-foreground"
                >
                    Age bands are computed as of <strong>{bandRef}</strong> (10-year bands, top band 90+). Dates
                    must be year-first (yyyy-mm-dd); anything else becomes [REDACTED]. Use{' '}
                    <Explain k="nav.advanced"><Link to="/advanced" className="underline text-accent hover:text-accent-hover">
                        Advanced mode
                    </Link></Explain>{' '}
                    to change the date or width.
                </p>
            )}
            <div className="flex items-center justify-between gap-4 p-3 border-t border-border">
                <Explain k="chooser.count">
                    <p className="text-muted text-sm">
                        {transformed} of {headers.length} columns will be transformed
                    </p>
                </Explain>
                <Explain k="action.anonymise">
                    <button
                        type="button"
                        onClick={() => onRun(policies)}
                        disabled={disabled}
                        className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-accent-foreground font-medium text-sm transition-colors"
                    >
                        Anonymise &amp; download
                    </button>
                </Explain>
            </div>
        </div>
    );
};

export default ColumnChooser;
