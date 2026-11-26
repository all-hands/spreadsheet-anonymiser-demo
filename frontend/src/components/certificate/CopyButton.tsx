import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import Explain from '../Explain';

export const CopyButton = ({ text, label }: { text: string; label: string }) => {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // clipboard blocked: the full value is still selectable on screen
        }
    };
    return (
        <Explain k="cert.copy">
        <button
            type="button"
            onClick={copy}
            aria-label={copied ? `${label} copied` : label}
            title={label}
            className="shrink-0 rounded-sm p-1 text-muted hover:bg-surface-hover hover:text-foreground focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
        >
            {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        </Explain>
    );
};

export default CopyButton;
