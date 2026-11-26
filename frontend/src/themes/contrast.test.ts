import { describe, expect, it } from 'vitest';
import { contrast } from './contrast';
import { themes } from './themes';

const TEXT = 4.5;
const UI = 3;

const PAIRS: [string, string, string, number][] = [
    ['body text on page', '--foreground', '--background', TEXT],
    ['body text on card', '--foreground', '--surface', TEXT],
    ['body text on tint', '--foreground', '--surface-2', TEXT],
    ['body text on hover', '--foreground', '--surface-hover', TEXT],
    ['muted text on page', '--muted', '--background', TEXT],
    ['muted text on card', '--muted', '--surface', TEXT],
    ['muted text on tint', '--muted', '--surface-2', TEXT],
    ['muted text on hover', '--muted', '--surface-hover', TEXT],
    ['title / active nav (accent-hover) on page', '--accent-hover', '--background', TEXT],
    ['title / active nav (accent-hover) on card', '--accent-hover', '--surface', TEXT],
    ['text on accent buttons', '--accent-foreground', '--accent', TEXT],
    ['text on accent-hover (button hover)', '--accent-foreground', '--accent-hover', UI],
    ['accent control on page', '--accent', '--background', UI],
    ['accent control on card', '--accent', '--surface', UI],
];

describe.each(themes)('theme $key contrast', (theme) => {
    it.each(PAIRS)('%s', (_label, fg, bg, min) => {
        const vars = theme.vars as unknown as Record<string, string>;
        const ratio = contrast(vars[fg], vars[bg]);
        expect(ratio, `${fg} on ${bg}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
    });
});
