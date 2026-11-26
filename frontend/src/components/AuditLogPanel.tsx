import { useAuditStore } from '../store/auditStore';
import type { AuditLogEntry } from '../types/audit';
import { operationLabel, policyColor, policyLabel } from '../lib/policy-ui';
import { PolicyIcon } from './PolicyIcon';
import Explain from './Explain';
import { clsx } from 'clsx';
import { Clock } from 'lucide-react';

const formatTimestamp = (ts: number): string => {
    return new Date(ts).toLocaleTimeString();
};

const EntryRow = ({ entry }: { entry: AuditLogEntry }) => {
    const color = policyColor(entry.operation);

    return (
        <Explain k="audit.entry">
        <div className="flex items-center gap-3 py-2 px-3 hover:bg-surface-hover rounded-sm">
            <PolicyIcon operation={entry.operation} size={16} className={color} />
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{entry.columnName}</div>
                <div className="text-xs text-muted">
                    {operationLabel(entry.operation, entry.keying).toUpperCase()} • {entry.rowsAffected} rows
                </div>
            </div>
            <div className="text-xs text-muted">
                {formatTimestamp(entry.timestamp)}
            </div>
        </div>
        </Explain>
    );
};

export const AuditLogPanel = () => {
    const { currentLog, getSummary } = useAuditStore();
    const summary = getSummary();

    if (!currentLog) {
        return (
            <div className="p-4 text-center text-muted">
                <p>No audit log available</p>
                <p className="text-xs mt-1">Process a file to generate an audit log</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <div className="p-4 border-b border-border">
                <Explain k="audit.title"><h3 className="font-semibold">Audit Log</h3></Explain>
                <div className="text-xs text-muted mt-1">
                    {currentLog.filename} • {currentLog.totalRows} rows
                </div>
                <Explain k="audit.status">
                <div className={clsx(
                    "text-xs mt-2 flex items-center gap-1",
                    currentLog.status === 'completed' && "text-success",
                    currentLog.status === 'processing' && "text-info animate-pulse",
                    currentLog.status === 'failed' && "text-danger",
                )}>
                    <Clock size={12} />
                    {currentLog.status.charAt(0).toUpperCase() + currentLog.status.slice(1)}
                </div>
                </Explain>
            </div>

            {currentLog.anonymity && (
                <div className="p-4 border-b border-border text-xs">
                    <div className="font-medium">{currentLog.anonymity.statement}</div>
                    <div className="text-muted mt-1">
                        On {currentLog.anonymity.quasiIdentifiers.join(', ')}. This is a measurement on this file,
                        not a claim of legal anonymity.
                    </div>
                </div>
            )}

            {summary && (
                <div className="p-4 border-b border-border grid grid-cols-4 gap-2 text-center">
                    {Object.entries(summary.byOperation).map(([op, count]) => (
                        <Explain key={op} k="audit.tile">
                        <div>
                            <div className={clsx("text-lg font-bold", policyColor(op))}>{count}</div>
                            <div className="text-[10px] text-muted">{policyLabel(op)}</div>
                        </div>
                        </Explain>
                    ))}
                </div>
            )}

            <div className="flex-1 overflow-auto p-2">
                {currentLog.entries.length === 0 ? (
                    <div className="text-center text-muted py-8">
                        No entries yet
                    </div>
                ) : (
                    currentLog.entries.map((entry) => (
                        <EntryRow key={entry.id} entry={entry} />
                    ))
                )}
            </div>

            {currentLog.completedAt && (
                <div className="p-3 border-t border-border text-xs text-muted">
                    Completed at {new Date(currentLog.completedAt).toLocaleString()}
                </div>
            )}
        </div>
    );
};

export default AuditLogPanel;
