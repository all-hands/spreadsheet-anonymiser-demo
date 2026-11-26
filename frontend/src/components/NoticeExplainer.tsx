import type { Explainer, ExplainerExample } from '../lib/notice-explainers';

const ExampleTable = ({ example }: { example: ExplainerExample }) => (
    <div className="mt-2">
        <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
                <caption className="pb-1 text-left font-medium text-muted">{example.caption}</caption>
                <thead>
                    <tr>
                        {example.headers.map((h) => (
                            <th
                                key={h}
                                scope="col"
                                className="border border-border bg-surface px-2 py-1 text-left font-semibold"
                            >
                                {h}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {example.rows.map((row, i) => (
                        <tr key={i}>
                            {row.map((cell, j) => (
                                <td key={j} className="border border-border px-2 py-1 break-words">
                                    {cell}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
        <p className="mt-1 text-xs text-muted">{example.takeaway}</p>
    </div>
);

export const ExplainerBody = ({ explainer }: { explainer: Explainer }) => (
    <div className="space-y-3 text-sm">
        <p className="font-semibold">{explainer.bottomLine}</p>
        <ul className="space-y-3">
            {explainer.points.map((p) => (
                <li key={p.heading} className="break-inside-avoid">
                    <p>
                        <strong className="font-semibold">{p.heading}.</strong>{' '}
                        <span className="text-muted">{p.text}</span>
                    </p>
                    {p.example && <ExampleTable example={p.example} />}
                </li>
            ))}
        </ul>
        {explainer.checklist && (
            <div className="break-inside-avoid">
                <p className="font-semibold">{explainer.checklistTitle}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
                    {explainer.checklist.map((c) => (
                        <li key={c}>{c}</li>
                    ))}
                </ul>
            </div>
        )}
    </div>
);
