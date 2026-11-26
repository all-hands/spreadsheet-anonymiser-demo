import {
    cloneElement,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useState,
    type FocusEvent,
    type PointerEvent,
    type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { explanationFor, type ExplanationKey } from '../lib/explanations';
import { useExplainStore } from '../store/explainStore';

const GAP = 6;
const MARGIN = 8;
const LEAVE_DELAY_MS = 150;

let closeActive: (() => void) | null = null;
let activeAnchor: HTMLElement | null = null;

interface ChildProps {
    onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
    onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
    onFocus?: (e: FocusEvent<HTMLElement>) => void;
    onBlur?: (e: FocusEvent<HTMLElement>) => void;
    'aria-describedby'?: string;
}

interface ExplainProps {
    k: ExplanationKey;
    text?: string;
    side?: 'below' | 'right';
    children: ReactElement<ChildProps>;
}

const Explain = ({ k, text, side = 'below', children }: ExplainProps) => {
    const enabled = useExplainStore((s) => s.enabled);
    const id = useId();
    const [hover, setHover] = useState(false);
    const [focus, setFocus] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [tip, setTip] = useState<HTMLDivElement | null>(null);
    const body = text ?? explanationFor(k);
    const open = enabled && !!body && (hover || focus);

    const place = useCallback(() => {
        if (!anchor || !tip) return;
        const r = anchor.getBoundingClientRect();
        const w = tip.offsetWidth;
        const h = tip.offsetHeight;
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        let left: number;
        let top: number;
        if (side === 'right' && r.right + GAP + w <= vw - MARGIN) {
            left = r.right + GAP;
            top = Math.min(r.top + r.height / 2 - h / 2, vh - h - MARGIN);
        } else {
            left = Math.max(MARGIN, Math.min(r.left + r.width / 2 - w / 2, vw - w - MARGIN));
            const below = r.bottom + GAP;
            top = below + h <= vh - MARGIN || r.top - GAP - h < MARGIN ? below : r.top - GAP - h;
        }
        tip.style.setProperty('left', `${Math.round(left)}px`);
        tip.style.setProperty('top', `${Math.round(Math.max(MARGIN, top))}px`);
    }, [anchor, tip, side]);

    useLayoutEffect(() => {
        if (open) place();
    }, [open, place, body]);

    useEffect(() => {
        if (!open) return;
        const close = () => {
            setHover(false);
            setFocus(false);
            setLeaving(false);
        };
        if (closeActive && closeActive !== close) {
            if (anchor && activeAnchor && anchor !== activeAnchor && anchor.contains(activeAnchor)) {
                close();
                return;
            }
            closeActive();
        }
        closeActive = close;
        activeAnchor = anchor;
        return () => {
            if (closeActive === close) {
                closeActive = null;
                activeAnchor = null;
            }
        };
    }, [open, anchor]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setHover(false);
                setFocus(false);
                setLeaving(false);
            }
        };
        const onDown = (e: globalThis.PointerEvent) => {
            const t = e.target as Node;
            if (anchor?.contains(t) || tip?.contains(t)) return;
            setHover(false);
            setLeaving(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onDown, true);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onDown, true);
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [open, place, anchor, tip]);

    useEffect(() => {
        if (!leaving) return;
        const t = setTimeout(() => {
            setHover(false);
            setLeaving(false);
        }, LEAVE_DELAY_MS);
        return () => clearTimeout(t);
    }, [leaving]);

    if (!enabled || !body) return children;

    const props = children.props;
    const described = [props['aria-describedby'], id].filter(Boolean).join(' ');
    const handlers: ChildProps = {
        onPointerEnter: (e) => {
            setAnchor(e.currentTarget);
            setLeaving(false);
            setHover(true);
            props.onPointerEnter?.(e);
        },
        onPointerLeave: (e) => {
            if (e.pointerType !== 'touch') setLeaving(true);
            props.onPointerLeave?.(e);
        },
        onFocus: (e) => {
            setAnchor(e.currentTarget);
            setFocus(true);
            props.onFocus?.(e);
        },
        onBlur: (e) => {
            setFocus(false);
            props.onBlur?.(e);
        },
        'aria-describedby': described,
    };

    return (
        <>
            {cloneElement(children, { ...handlers, 'data-explain': k } as ChildProps)}
            {open &&
                createPortal(
                    <div
                        ref={setTip}
                        id={id}
                        role="tooltip"
                        onPointerEnter={() => {
                            setLeaving(false);
                            setHover(true);
                        }}
                        onPointerLeave={(e) => {
                            if (e.pointerType !== 'touch') setLeaving(true);
                        }}
                        className="print:hidden fixed left-0 top-0 z-50 w-max max-w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-normal normal-case leading-4 tracking-normal text-foreground shadow-lg"
                    >
                        {body}
                    </div>,
                    document.body
                )}
        </>
    );
};

export default Explain;
