import { useExplainStore } from '../store/explainStore';
import Explain from './Explain';

const ExplainToggle = () => {
    const enabled = useExplainStore((s) => s.enabled);
    const setEnabled = useExplainStore((s) => s.setEnabled);
    return (
        <Explain k="explain.toggle">
            <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => setEnabled(!enabled)}
                className="group flex items-center gap-2 rounded-lg text-xs text-muted select-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
            >
                <span
                    aria-hidden="true"
                    className={`relative inline-block h-5 w-9 shrink-0 rounded-full border transition-colors after:absolute after:top-0.5 after:left-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:transition-transform ${
                        enabled
                            ? 'border-accent bg-accent after:translate-x-4 after:bg-accent-foreground'
                            : 'border-border bg-surface-2 after:bg-foreground'
                    }`}
                />
                Show explanations on hover
            </button>
        </Explain>
    );
};

export default ExplainToggle;
