import { useState } from 'react';
import { useDatasetStore } from '../../store/datasetStore';
import { useAdvancedSessionStore } from '../../store/advancedSessionStore';
import { applyOptimal, applyPseudonymisePreset } from '../../lib/anonymity-run';
import { quasiIdentifiers } from '../../lib/anonymity';
import PolicyParams from '../PolicyParams';
import Explain from '../Explain';
import { retype } from '../../lib/policy-params';
import { SELECTABLE_POLICY_OPTIONS } from '../../types/policy';
import type { ColumnPolicy, PolicyOption, PolicyType } from '../../types/policy';

export type BulkScope = 'all' | 'selected' | 'keep';

interface BulkPolicyBarProps {
    headers: string[];
    selected: ReadonlySet<number>;
}

const GROUP_LABELS: Record<PolicyOption['group'], string> = {
    standard: 'Policies',
    legacy: 'Legacy (old web app)',
};

const FIELD =
    'bg-surface-2 border border-border rounded-sm px-1.5 py-1 text-xs text-foreground focus:outline-hidden focus:border-accent';

const plural = (n: number) => `${n} column${n === 1 ? '' : 's'}`;

const BulkPolicyBar = ({ headers, selected }: BulkPolicyBarProps) => {
    const policies = useDatasetStore((s) => s.policies);
    const setPolicies = useDatasetStore((s) => s.setPolicies);
    const [draft, setDraft] = useState<ColumnPolicy>({ type: 'hash' });
    const [scope, setScope] = useState<BulkScope>('all');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const undo = useAdvancedSessionStore((st) => st.undo);
    const roles = useDatasetStore((st) => st.roles);
    const hasQi = quasiIdentifiers(roles, headers.length).length > 0;

    const targets = headers
        .map((_, i) => i)
        .filter((i) =>
            scope === 'all' ? true
                : scope === 'selected' ? selected.has(i)
                    : (policies[i]?.type ?? 'keep') === 'keep'
        );

    const blocker = targets.length > 0 ? ''
        : scope === 'selected' ? 'Tick at least one column in the grid first.'
            : scope === 'keep' ? 'No column is still on Keep.'
                : 'There are no columns.';

    const apply = () => {
        const { type, width, referenceDate } = draft;
        useAdvancedSessionStore.getState().snapshot(`Bulk apply ${type}`);
        setPolicies(targets, type, { width, referenceDate });
        setMessage(`Applied ${type} to ${plural(targets.length)}`);
    };

    const resetAll = () => {
        useAdvancedSessionStore.getState().snapshot('Reset all to Keep');
        setPolicies(headers.map((_, i) => i), 'keep');
        setMessage(`Reset ${plural(headers.length)} to keep`);
    };

    const pseudonymise = () => {
        const n = applyPseudonymisePreset();
        setMessage(
            `Pseudonymise preset: ${n} column${n === 1 ? '' : 's'} changed. Identifiers get a keyed token ` +
                '(enter a passphrase to run), free text is redacted, the rest is kept, Sensitive columns included (the data is still personal data).'
        );
    };

    const anonymise = async () => {
        setBusy(true);
        setMessage('Searching for the least generalisation that reaches k...');
        try {
            setMessage(await applyOptimal({ label: 'Anonymise preset' }));
        } catch (err: unknown) {
            setMessage(`Anonymise preset failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="rounded-xl border border-border bg-surface p-3 flex flex-wrap items-center gap-2 text-xs">
            <Explain k="bulk.title"><span className="font-medium text-foreground">Bulk apply</span></Explain>
            <Explain k={`policy:${draft.type}`}>
            <select
                value={draft.type}
                onChange={(e) => setDraft(retype(e.target.value as PolicyType, draft))}
                aria-label="Policy to apply"
                className={FIELD}
            >
                {(['standard', 'legacy'] as const).map((g) => {
                    const options = SELECTABLE_POLICY_OPTIONS.filter((o) => o.group === g);
                    if (options.length === 0) return null;
                    return (
                        <optgroup key={g} label={GROUP_LABELS[g]}>
                            {options.map((o) => (
                                <option key={o.type} value={o.type}>{o.label}</option>
                            ))}
                        </optgroup>
                    );
                })}
            </select>
            </Explain>
            <PolicyParams
                policy={draft}
                name="bulk apply"
                onChange={(params) => setDraft({ ...draft, ...params })}
            />
            <Explain k="bulk.scope">
            <select
                value={scope}
                onChange={(e) => setScope(e.target.value as BulkScope)}
                aria-label="Columns to apply to"
                className={FIELD}
            >
                <option value="all">All columns</option>
                <option value="selected">Selected columns</option>
                <option value="keep">Only columns still on Keep</option>
            </select>
            </Explain>
            <Explain k="bulk.apply">
            <button
                type="button"
                onClick={apply}
                disabled={targets.length === 0}
                aria-describedby={blocker ? 'bulk-apply-blocker' : undefined}
                className="px-3 py-1 rounded-sm bg-accent text-white disabled:opacity-50"
            >
                Apply
            </button>
            </Explain>
            {blocker && (
                <span id="bulk-apply-blocker" className="text-muted">{blocker}</span>
            )}
            <Explain k="bulk.reset">
            <button
                type="button"
                onClick={resetAll}
                className="px-3 py-1 rounded-sm border border-border text-foreground"
            >
                Reset all to Keep
            </button>
            </Explain>
            {undo && (
                <Explain k="bulk.undo">
                <button
                    type="button"
                    onClick={() => {
                        useAdvancedSessionStore.getState().undoLast();
                        setMessage(`Undone: ${undo.label}.`);
                    }}
                    className="px-3 py-1 rounded-sm border border-border text-foreground"
                >
                    Undo {undo.label}
                </button>
                </Explain>
            )}
            <span role="status" aria-live="polite" className="text-muted">{message}</span>
            <div role="group" aria-label="Presets" className="basis-full flex flex-col gap-2 border-t border-border pt-3 sm:flex-row">
                <Explain k="presets.title"><span className="font-semibold text-foreground sm:self-center">Presets</span></Explain>
                <div className="flex flex-1 flex-col gap-1 rounded-lg border border-border bg-surface-2 p-2">
                    <Explain k="preset.pseudonymise">
                    <button
                        type="button"
                        onClick={pseudonymise}
                        className="self-start px-3 py-1.5 rounded-sm bg-accent text-white text-sm font-medium"
                    >
                        Pseudonymise preset
                    </button>
                    </Explain>
                    <span className="text-muted">
                        Pseudonymise: replace direct identifiers with keyed tokens; reversible with the key.
                    </span>
                </div>
                <div className="flex flex-1 flex-col gap-1 rounded-lg border border-border bg-surface-2 p-2">
                    <Explain k="preset.anonymise">
                    <button
                        type="button"
                        onClick={anonymise}
                        disabled={busy || !hasQi}
                        aria-describedby={!hasQi ? 'anonymise-preset-blocker' : undefined}
                        className="self-start px-3 py-1.5 rounded-sm bg-accent text-white text-sm font-medium disabled:opacity-50"
                    >
                        {busy ? 'Working...' : 'Anonymise preset'}
                    </button>
                    </Explain>
                    <span className="text-muted">
                        Anonymise: drop identifiers and generalise until every person hides in a group of k.
                    </span>
                    {!hasQi && (
                        <span id="anonymise-preset-blocker" className="text-warning">
                            Off: no column is marked as a Quasi-identifier. Mark columns such as date of birth, postcode,
                            city or department with the Role menu in the grid, then try again.
                        </span>
                    )}
                </div>
            </div>

        </div>
    );
};

export default BulkPolicyBar;
