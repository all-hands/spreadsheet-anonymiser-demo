import { describe, it, expect } from 'vitest';
import {
    defaultReferenceDate,
    isIsoDate,
    isWidth,
    policyDetails,
    retype,
    takesReferenceDate,
    takesWidth,
} from './policy-params';

describe('policy-params', () => {
    it('knows which policies take which parameter', () => {
        expect(takesWidth('age-band')).toBe(true);
        expect(takesWidth('bucket')).toBe(true);
        expect(takesWidth('year')).toBe(false);
        expect(takesWidth('hash')).toBe(false);
        expect(takesReferenceDate('age-band')).toBe(true);
        expect(takesReferenceDate('bucket')).toBe(false);
    });

    it('defaults the reference date to Jan 1 of the given year', () => {
        expect(defaultReferenceDate(new Date(2031, 6, 15))).toBe('2031-01-01');
        expect(defaultReferenceDate(new Date(950, 0, 1))).toBe('0950-01-01');
    });

    it('validates yyyy-mm-dd strictly, leap days included', () => {
        for (const ok of ['2026-01-01', '2024-02-29', '2000-02-29', '0001-12-31'])
            expect(isIsoDate(ok), ok).toBe(true);
        for (const bad of [
            '2023-02-29',
            '1900-02-29',
            '2026-13-01',
            '2026-00-10',
            '2026-04-31',
            '2026-1-1',
            '2026/01/01',
            '01/01/2026',
            '0000-01-01',
            '',
            ' 2026-01-01',
            20260101,
            null,
            undefined,
        ])
            expect(isIsoDate(bad), String(bad)).toBe(false);
    });

    it('accepts only positive whole-number widths', () => {
        expect(isWidth(1)).toBe(true);
        expect(isWidth(10)).toBe(true);
        for (const bad of [0, -5, 2.5, NaN, Infinity, '10', null, undefined, 2 ** 32])
            expect(isWidth(bad), String(bad)).toBe(false);
    });

    describe('retype', () => {
        it('gives age-band a visible default reference date and no width', () => {
            const p = retype('age-band');
            expect(p.type).toBe('age-band');
            expect(p.referenceDate).toMatch(/^\d{4}-01-01$/);
            expect(p.width).toBeUndefined();
        });

        it('keeps applicable parameters and drops the rest', () => {
            const ab = { type: 'age-band' as const, width: 5, referenceDate: '2020-01-01' };
            expect(retype('bucket', ab)).toEqual({ type: 'bucket', width: 5 });
            expect(retype('age-band', ab)).toEqual(ab);
            expect(retype('year', ab)).toEqual({ type: 'year' });
            expect(retype('redact', ab)).toEqual({ type: 'redact' });
        });

        it('keeps the canon type across a re-type (as setPolicy always did)', () => {
            expect(retype('hash', { type: 'hash', canon: 'email' })).toEqual({
                type: 'hash',
                canon: 'email',
            });
        });

        it('leaves plain policies exactly {type}', () => {
            expect(retype('redact')).toEqual({ type: 'redact' });
            expect(retype('year')).toEqual({ type: 'year' });
        });
    });

    it('describes the parameters in force for the audit log', () => {
        expect(policyDetails(undefined)).toBeUndefined();
        expect(policyDetails({ type: 'hash' })).toBeUndefined();
        expect(policyDetails({ type: 'year' })).toBeUndefined();
        expect(policyDetails({ type: 'bucket' })).toBe('width 10');
        expect(policyDetails({ type: 'bucket', width: 5 })).toBe('width 5');
        expect(policyDetails({ type: 'age-band', referenceDate: '2026-01-01' })).toBe(
            'width 10, reference date 2026-01-01'
        );
        expect(policyDetails({ type: 'age-band' })).toBe('width 10, reference date (unset)');
    });
});
