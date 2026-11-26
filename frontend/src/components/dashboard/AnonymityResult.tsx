import type { ReactNode } from 'react';
import Explain from '../Explain';
import type { ExplanationKey } from '../../lib/explanations';
import type { MeasureResult, SuppressMode } from '../../types/anonymity';

const AnonymityResult = ({
    fresh, hasStale, offenders, suppressMode, atRisk,
}: {
    fresh: MeasureResult | null;
    hasStale: boolean;
    offenders: { name: string; entry: { rows_below_k_without: number } }[];
    suppressMode: SuppressMode;
    atRisk: ReactNode;
}) => {
    const result = hasStale;
    return (
        <>
            {fresh ? (
                <div aria-label="Anonymity result" className="flex flex-col gap-2">
                    <dl className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                        <Stat k="stat.minGroup" label="Smallest group" value={fresh.report.min_group} />
                        <Stat k="stat.belowK" label={`Rows below k=${fresh.report.k}`} value={fresh.report.rows_below_k} />
                        <Stat k="stat.groups" label="Groups" value={fresh.report.groups} />
                        <Stat k="stat.rows" label="Rows" value={fresh.report.rows} />
                    </dl>
                    {!fresh.report.satisfied && offenders.length > 0 && (
                        <p className="text-xs text-muted">
                            Worst offenders (dropping the column would leave fewest rows below k):{' '}
                            {offenders
                                .map((o) => `${o.name} (${o.entry.rows_below_k_without} rows below k without it)`)
                                .join(', ')}
                            .
                        </p>
                    )}
                    {atRisk}
                    {fresh.report.rows_below_k > 0 && (
                        <p className="text-xs text-muted">
                            An anonymous release would {suppressMode === 'cells'
                                ? `replace the quasi-identifier cells of ${fresh.report.rows_below_k} rows with *`
                                : `drop ${fresh.report.rows_below_k} rows`}.
                        </p>
                    )}
                    {fresh.report.rows_below_k === 0 && (
                        <p className="text-xs text-success" data-testid="anonymity-success">
                            0 rows below k={fresh.report.k}: every group of quasi-identifier values has at least {fresh.report.k} rows.
                        </p>
                    )}
                    <p className="text-xs text-foreground">{fresh.claim}</p>
                </div>
            ) : result ? (
                <p className="text-xs text-muted">Settings changed since the last measurement: measure again.</p>
            ) : null}
        </>
    );
};

const Stat = ({ k, label, value }: { k: ExplanationKey; label: string; value: number }) => (
    <Explain k={k}>
        <div className="p-2 bg-surface-2 rounded-lg flex flex-col-reverse">
            <dt className="text-[10px] text-muted">{label}</dt>
            <dd className="text-lg font-bold text-foreground">{value}</dd>
        </div>
    </Explain>
);

export default AnonymityResult;
