import { Info } from 'lucide-react';
import { clsx } from 'clsx';
import { noticeFor } from '../lib/notices';
import type { PassedAnonymity } from '../lib/notices';
import { useId, useState } from 'react';
import { explainerFor } from '../lib/notice-explainers';
import type { Notice } from '../lib/notices';
import { ExplainerBody } from './NoticeExplainer';
import Explain from './Explain';

const useWhyToggle = (variant: Notice['variant']) => {
    const [open, setOpen] = useState(false);
    const panelId = useId();
    const explainer = explainerFor(variant);
    const toggle = (
        <Explain k={variant === 'k-anonymity' ? 'notice.why.k-anonymity' : 'notice.why.pseudonymised'}>
        <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
            className="ml-1.5 rounded-sm font-medium text-foreground underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
            (why?)
        </button>
        </Explain>
    );
    const panel = (
        <div
            id={panelId}
            role="region"
            aria-label={explainer.title}
            hidden={!open}
            className="mt-3 rounded-md border border-border bg-background px-3 py-3"
        >
            {open && <ExplainerBody explainer={explainer} />}
        </div>
    );
    return { toggle, panel };
};

export const PseudonymisationNotice = ({
    className,
    anonymity,
    withExplainer = true,
}: {
    className?: string;
    anonymity?: PassedAnonymity | null;
    withExplainer?: boolean;
}) => {
    const notice = noticeFor(anonymity);
    const { toggle, panel } = useWhyToggle(notice.variant);
    return (
        <div
            role="note"
            aria-label="Pseudonymisation notice"
            data-variant={notice.variant}
            className={clsx(
                'flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground',
                className,
            )}
        >
            <Info size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            <div className="min-w-0 flex-1">
                <p>
                    <strong className="font-semibold">{notice.line}</strong>{' '}
                    <span className="text-muted">{notice.detail}</span>
                    {withExplainer && toggle}
                </p>
                {withExplainer && panel}
            </div>
        </div>
    );
};

export default PseudonymisationNotice;
