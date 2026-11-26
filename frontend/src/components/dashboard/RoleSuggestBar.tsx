import { useState } from 'react';
import { useDatasetStore } from '../../store/datasetStore';
import Explain from '../Explain';
import { columnType, isNumericColumn, suggestedPolicyForRole } from '../../lib/roles';

const RoleSuggestBar = () => {
    const headers = useDatasetStore((s) => s.headers);
    const roles = useDatasetStore((s) => s.roles);
    const policies = useDatasetStore((s) => s.policies);
    const metadata = useDatasetStore((s) => s.metadata);
    const data = useDatasetStore((s) => s.data);
    const apply = useDatasetStore((s) => s.applyRolePolicies);
    const [message, setMessage] = useState('');

    const wouldChange = headers.filter((_, i) => {
        const role = roles[i];
        if (!role) return false;
        const type = columnType(metadata, data, i);
        return (policies[i]?.type ?? 'keep') !== suggestedPolicyForRole(role, type, isNumericColumn(data, i)).type;
    }).length;

    return (
        <div className="rounded-xl border border-border bg-surface p-3 flex flex-wrap items-center gap-2 text-xs">
            <Explain k="roles.title"><span className="font-medium text-foreground">Column roles</span></Explain>
            <span className="text-muted">
                Pick a role per column in the grid (pre-selected from the names; roles are not saved in policy.json).
            </span>
            <Explain k="roles.suggest">
            <button
                type="button"
                onClick={() => {
                    const n = apply();
                    setMessage(
                        n === 0
                            ? 'Suggestions applied: no column needed changing.'
                            : `Suggestions applied: ${n} column${n === 1 ? '' : 's'} changed.`
                    );
                }}
                className="px-3 py-1 rounded-sm bg-accent text-white"
            >
                Suggest policies from roles
            </button>
            </Explain>
            <span className="text-muted">Would change {wouldChange} of {headers.length} columns.</span>
            <span role="status" aria-live="polite" className="font-medium text-foreground">{message}</span>
        </div>
    );
};

export default RoleSuggestBar;
