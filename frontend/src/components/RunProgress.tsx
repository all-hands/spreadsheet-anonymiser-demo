import { formatBytes } from '../lib/format';
import type { StreamProgress } from '../lib/worker-client';
import Explain from './Explain';

interface RunProgressProps {
    progress: StreamProgress | null;
    onCancel: () => void;
}

const RunProgress = ({ progress, onCancel }: RunProgressProps) => {
    if (!progress) return null;
    const pct = progress.total > 0 ? Math.min(100, Math.floor((progress.bytes / progress.total) * 100)) : 0;
    return (
        <div className="flex flex-col items-center gap-2 w-full max-w-md self-center">
            <Explain k="progress">
                <progress
                    value={pct}
                    max={100}
                    aria-label="Processing progress"
                    className="w-full h-2 accent-current"
                />
            </Explain>
            <p role="status" className="font-mono text-sm text-muted">
                {formatBytes(progress.bytes)} of {formatBytes(progress.total)} ({pct}%) —{' '}
                {progress.rows.toLocaleString()} rows
            </p>
            <Explain k="action.cancel">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-3 py-1 bg-surface-2 hover:bg-surface-hover rounded-lg text-foreground text-sm transition-colors"
                >
                    Cancel
                </button>
            </Explain>
        </div>
    );
};

export default RunProgress;
