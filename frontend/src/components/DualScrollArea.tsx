import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, Ref, UIEvent } from 'react';
import { clsx } from 'clsx';
import Explain from './Explain';
import type { ExplanationKey } from '../lib/explanations';
import { assignRef } from '../lib/scroll-link';

interface DualScrollAreaProps {
    children: ReactNode;
    className?: string;
    scrollerClassName?: string;
    scrollerRef?: Ref<HTMLDivElement>;
    onScroll?: (e: UIEvent<HTMLDivElement>) => void;
    label?: string;
    explain: ExplanationKey;
}

const DualScrollArea = ({ children, className, scrollerClassName, scrollerRef, onScroll, label, explain }: DualScrollAreaProps) => {
    const topRef = useRef<HTMLDivElement>(null);
    const mainRef = useRef<HTMLDivElement | null>(null);
    const [width, setWidth] = useState(0);
    const [gutter, setGutter] = useState(0);

    const setMain = useCallback((el: HTMLDivElement | null) => {
        mainRef.current = el;
        assignRef(scrollerRef, el);
    }, [scrollerRef]);

    useEffect(() => {
        const el = mainRef.current;
        if (!el) return;
        const measure = () => {
            setWidth(el.scrollWidth);
            setGutter(el.offsetWidth - el.clientWidth);
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        for (const child of Array.from(el.children)) ro.observe(child);
        return () => ro.disconnect();
    }, [children]);

    const onTop = () => {
        const t = topRef.current;
        const m = mainRef.current;
        if (t && m && m.scrollLeft !== t.scrollLeft) m.scrollLeft = t.scrollLeft;
    };
    const onMain = (e: UIEvent<HTMLDivElement>) => {
        const t = topRef.current;
        const m = e.currentTarget;
        if (t && t.scrollLeft !== m.scrollLeft) t.scrollLeft = m.scrollLeft;
        onScroll?.(e);
    };

    return (
        <div className={clsx('flex min-h-0 flex-col', className)}>
            <div
                ref={topRef}
                onScroll={onTop}
                data-testid="scroll-top"
                style={{ marginRight: gutter }}
                aria-hidden="true"
                className="scroll-visible overflow-x-scroll overflow-y-hidden shrink-0 border-b border-border"
            >
                <div style={{ width, height: 1 }} />
            </div>
            <Explain k={explain}>
            <div
                ref={setMain}
                onScroll={onMain}
                role="region"
                aria-label={label}
                tabIndex={0}
                data-testid="scroll-main"
                className={clsx('scroll-visible relative overflow-scroll min-h-0', scrollerClassName)}
            >
                {children}
            </div>
            </Explain>
        </div>
    );
};

export default DualScrollArea;
