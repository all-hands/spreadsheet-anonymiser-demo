import { describe, expect, it } from 'vitest';
import { displayCell, EMPTY_CELL } from './cell-display';

describe('displayCell', () => {
    it('marks null, undefined and empty', () => {
        expect(displayCell(null).text).toBe(EMPTY_CELL);
        expect(displayCell(undefined).text).toBe(EMPTY_CELL);
        expect(displayCell('')).toEqual({ text: EMPTY_CELL, full: '', truncated: false });
    });
    it('shows up to 20 characters whole', () => {
        const s = 'a'.repeat(20);
        expect(displayCell(s)).toEqual({ text: s, full: s, truncated: false });
    });
    it('shortens 21+ characters to first10…last10', () => {
        const s = '0123456789ABCDEFGHIJK';
        const d = displayCell(s);
        expect(d.text).toBe('0123456789…BCDEFGHIJK');
        expect(d.full).toBe(s);
        expect(d.truncated).toBe(true);
    });
    it('stringifies numbers and booleans', () => {
        expect(displayCell(42).text).toBe('42');
        expect(displayCell(0).text).toBe('0');
        expect(displayCell(false).text).toBe('false');
        expect(displayCell(-Number.MAX_SAFE_INTEGER * 1e10).truncated).toBe(true);
    });
    it('counts code points, never splitting surrogate pairs', () => {
        const s = '😀'.repeat(20);
        expect(displayCell(s).truncated).toBe(false);
        const d = displayCell('😀'.repeat(25));
        expect(d.text).toBe(`${'😀'.repeat(10)}…${'😀'.repeat(10)}`);
        expect(d.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    });
    it('keeps whitespace and newlines in full', () => {
        expect(displayCell('a\nb').full).toBe('a\nb');
    });
});
