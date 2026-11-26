import { describe, it, expect } from 'vitest';
import { explainerFor } from './notice-explainers';

const text = (v: 'pseudonymised' | 'k-anonymity') => JSON.stringify(explainerFor(v));

describe('notice explainers', () => {
    it('both open with the bottom line', () => {
        for (const v of ['pseudonymised', 'k-anonymity'] as const) {
            expect(explainerFor(v).bottomLine).toMatch(/No tool can certify a file as anonymous/);
        }
    });

    it('pseudonymised covers linking, kept columns, GDPR and the alternative', () => {
        const t = text('pseudonymised');
        for (const re of [
            /a1b2c3/,
            /same token/,
            /date of birth/,
            /postcode/,
            /recital 26/,
            /Anonymise preset/,
            /Anonymous release/,
        ]) {
            expect(t).toMatch(re);
        }
    });

    it('k-anonymity covers each limit and a checklist', () => {
        const t = text('k-anonymity');
        for (const re of [
            /k\u22121/,
            /diabetes/,
            /outside|other dataset/i,
            /free text/i,
            /small files/i,
            /recital 26/,
            /reasonably likely/,
        ]) {
            expect(t).toMatch(re);
        }
        expect(explainerFor('k-anonymity').checklist?.length).toBeGreaterThan(3);
    });

    it('every example is a rectangular table', () => {
        for (const v of ['pseudonymised', 'k-anonymity'] as const) {
            for (const p of explainerFor(v).points) {
                for (const r of p.example?.rows ?? []) expect(r).toHaveLength(p.example!.headers.length);
            }
        }
    });
});
