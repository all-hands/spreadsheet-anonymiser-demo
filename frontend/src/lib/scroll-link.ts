import type { Ref } from 'react';

export const assignRef = <T>(ref: Ref<T> | undefined, el: T | null): void => {
    if (typeof ref === 'function') ref(el);
    else if (ref) (ref as { current: T | null }).current = el;
};

export const linkScroll = (from: HTMLElement | null, to: HTMLElement | null): void => {
    if (!from || !to) return;
    if (to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
    if (to.scrollTop !== from.scrollTop) to.scrollTop = from.scrollTop;
};
