import { TriangleExclamationPoint } from 'lucide-react';
import Explain from './Explain';

export const ErrorPanel = ({ onRetry }: { onRetry?: () => void }) => (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-background text-foreground">
        <div
            role="alert"
            className="max-w-md w-full rounded-2xl border border-border bg-surface p-8 text-center"
        >
            <TriangleExclamationPoint size={40} className="mx-auto mb-4 text-warning" aria-hidden="true" />
            <Explain k="error.heading"><h1 className="text-xl font-semibold">Something went wrong</h1></Explain>
            <p className="mt-2 text-sm text-muted">
                The page hit an unexpected error. Your file never left this device. Reloading
                starts fresh; you will need to select your file again.
            </p>
            <div className="mt-6 flex justify-center gap-3">
                {onRetry && (
                    <Explain k="error.retry">
                    <button
                        type="button"
                        onClick={onRetry}
                        className="px-4 py-2 rounded-lg bg-surface-2 hover:bg-surface-hover text-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        Try again
                    </button>
                    </Explain>
                )}
                <Explain k="error.reload">
                <button
                    type="button"
                    onClick={() => window.location.assign('/')}
                    className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-accent-foreground text-sm font-medium focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                    Reload
                </button>
                </Explain>
            </div>
        </div>
    </div>
);

export const RouteError = () => <ErrorPanel />;

export default ErrorPanel;
