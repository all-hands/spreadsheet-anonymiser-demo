import { useDatasetStore } from '../store/datasetStore';
import { COLUMN_ROLES, ROLE_LABELS, isUngeneralisedQuasi } from '../lib/roles';
import Explain from './Explain';
import type { ColumnRole } from '../lib/roles';

const RoleSelector = ({ colIndex, header }: { colIndex: number; header?: string }) => {
    const role = useDatasetStore((s) => s.roles[colIndex]);
    const policy = useDatasetStore((s) => s.policies[colIndex]);
    const setRole = useDatasetStore((s) => s.setRole);
    const name = header ? `"${header}"` : `column ${colIndex + 1}`;
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted" aria-hidden="true">Role</span>
            <Explain k={`role:${role ?? 'other'}`}>
            <select
                value={role ?? 'other'}
                onChange={(e) => setRole(colIndex, e.target.value as ColumnRole)}
                aria-label={`Role for ${name}`}
                className="min-w-0 bg-surface-2 border border-border rounded-sm px-1.5 py-1 text-xs text-foreground focus:outline-hidden focus:border-accent"
            >
                {COLUMN_ROLES.map((r) => (
                    <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                    </option>
                ))}
            </select>
            </Explain>
            <div className="h-8 overflow-hidden text-[10px] leading-4 text-warning whitespace-normal" data-testid="role-warning-slot">
                {isUngeneralisedQuasi(role, policy) && (
                    <Explain k="role.warning">
                        <span>Quasi-identifier kept as-is: generalise it, or rare values get suppressed.</span>
                    </Explain>
                )}
            </div>
        </div>
    );
};

export default RoleSelector;
