import { useDatasetStore } from '../store/datasetStore';
import PolicyParams from './PolicyParams';
import Explain from './Explain';
import { CANON_TYPE_STRINGS, SELECTABLE_POLICY_OPTIONS } from '../types/policy';
import type { CanonType, PolicyOption } from '../types/policy';

interface PolicySelectorProps {
    colIndex: number;
    header?: string;
}

const GROUP_LABELS: Record<PolicyOption['group'], string> = {
    standard: 'Policies',
    legacy: 'Legacy (old web app)',
};

const PolicySelector = ({ colIndex, header }: PolicySelectorProps) => {
    const { policies, setPolicy, setCanon, setParams } = useDatasetStore();
    const currentPolicy = policies[colIndex]?.type || 'keep';

    const name = header ? `"${header}"` : `column ${colIndex + 1}`;
    const groups = ['standard', 'legacy'] as const;

    return (
        <div className="flex flex-wrap content-start gap-1 min-h-[4.5rem]" data-testid="policy-controls">
            <span className="w-full text-[10px] uppercase tracking-wide text-muted" aria-hidden="true">Anonymisation</span>
            <Explain k={`policy:${currentPolicy}`}>
            <select
                value={currentPolicy}
                onChange={(e) => setPolicy(colIndex, e.target.value as typeof currentPolicy)}
                aria-label={`Policy for ${name}`}
                className="min-w-0 flex-1 bg-surface-2 border border-border rounded-sm px-1.5 py-1 text-xs text-foreground focus:outline-hidden focus:border-accent"
            >
                {groups.map((g) => {
                    const options = SELECTABLE_POLICY_OPTIONS.filter((o) => o.group === g);
                    if (options.length === 0) return null;
                    return (
                        <optgroup key={g} label={GROUP_LABELS[g]}>
                            {options.map((o) => (
                                <option key={o.type} value={o.type}>
                                    {o.label}
                                </option>
                            ))}
                        </optgroup>
                    );
                })}
            </select>
            </Explain>
            <PolicyParams
                policy={policies[colIndex]}
                name={name}
                onChange={(params) => setParams(colIndex, params)}
            />
            {currentPolicy === 'hash' && (
                <Explain k={`canon:${policies[colIndex]?.canon ?? 'auto'}`}>
                <select
                    value={policies[colIndex]?.canon ?? 'auto'}
                    onChange={(e) => setCanon(colIndex, e.target.value as CanonType)}
                    aria-label={`Canonicalization for ${name}`}
                    className="bg-surface-2 border border-border rounded-sm px-1.5 py-1 text-xs text-foreground focus:outline-hidden focus:border-accent"
                >
                    {CANON_TYPE_STRINGS.map((t) => (
                        <option key={t} value={t}>
                            {t === 'auto' ? 'canon: auto' : t}
                        </option>
                    ))}
                </select>
                </Explain>
            )}
        </div>
    );
};

export default PolicySelector;
