import { describe, expect, it } from 'vitest';
import {
    anonymityAudit,
    anonymityStatement,
    detectedIdentifierColumns,
    directIdentifierColumns,
    identifierColumns,
    keepsRelinkability,
    quasiIdentifiers,
    releaseProblems,
    worstOffenders,
    RELEASE_ALLOWED,
    releaseAllowedProse,
} from './anonymity';
import { ladderFor } from './anonymity-plan';
import type { ColumnPolicy } from '../types/policy';
import type { ReleaseCheck } from '../types/anonymity';

const HEADERS = ['id', 'email', 'dob', 'city', 'plan'];
const REQ = { qi: [2, 3], identifiers: [0, 1], k: 5, mode: 'cells' as const };
const OK: Record<number, ColumnPolicy> = {
    0: { type: 'redact' },
    1: { type: 'redact' },
    2: { type: 'year' },
    3: { type: 'keep' },
    4: { type: 'mask' },
};
const problems = (policies = OK, request = REQ, streamed = false) =>
    releaseProblems({ headers: HEADERS, policies, request, streamed });

describe('keepsRelinkability', () => {
    it.each(['hash', 'faux', 'encrypt', 'kyber-aes', 'legacy-sha256', 'legacy-aes'] as const)('%s keeps a link', (t) => {
        expect(keepsRelinkability({ type: t })).toBe(true);
    });
    it.each(['keep', 'redact', 'mask', 'mask-email', 'mask-last4', 'year', 'age-band', 'bucket'] as const)('%s does not', (t) => {
        expect(keepsRelinkability({ type: t })).toBe(false);
    });
    it('hash keyed for this run only is allowed', () => {
        expect(keepsRelinkability({ type: 'hash', keying: 'run' })).toBe(false);
    });
    it('a column with no policy is keep', () => expect(keepsRelinkability(undefined)).toBe(false));
});

describe('releaseProblems', () => {
    it('is empty for a compliant setup', () => expect(problems()).toEqual([]));

    it('requires at least one quasi-identifier', () => {
        expect(problems(OK, { ...REQ, qi: [] }).join(' ')).toMatch(/at least one column as a Quasi-identifier/);
    });

    it('names the columns whose policy keeps re-linkability', () => {
        const out = problems({ ...OK, 4: { type: 'hash' }, 3: { type: 'faux' } });
        expect(out).toHaveLength(1);
        expect(out[0]).toContain('"city" (Faux)');
        expect(out[0]).toContain('"plan" (Hash)');
    });

    it('lets hash through only when keyed for this run', () => {
        expect(problems({ ...OK, 4: { type: 'hash', keying: 'run' } })).toEqual([]);
    });

    it.each(['mask-email', 'mask-last4'] as const)('refuses %s on any column (allow-list, fail closed)', (t) => {
        const out = problems({ ...OK, 4: { type: t } });
        expect(out).toHaveLength(1);
        expect(out[0]).toMatch(/^These columns use a policy an anonymous release does not allow: "plan"/);
    });

    it('blocks identifier columns left on keep, naming them', () => {
        const out = problems({ ...OK, 0: { type: 'keep' } });
        expect(out.join(' ')).toContain('Direct identifier columns must be redacted: "id" (Keep)');
    });

    it.each(['mask', 'mask-email', 'mask-last4', 'year', 'bucket'] as const)(
        'refuses a direct identifier left on %s (fail closed)',
        (t) => {
            const out = problems({ ...OK, 1: { type: t } });
            expect(out.join(' ')).toContain('Direct identifier columns must be redacted: "email"');
        }
    );

    it('refuses an identifier with no policy entry', () => {
        const { 1: _gone, ...rest } = OK;
        void _gone;
        expect(problems(rest).join(' ')).toContain('"email" (Keep)');
    });

    it('blocks streamed files (the check cannot be measured there)', () => {
        expect(problems(OK, REQ, true).join(' ')).toMatch(/streamed/);
    });

    it('rejects k outside 2..50', () => {
        expect(problems(OK, { ...REQ, k: 1 }).join(' ')).toMatch(/k must be/);
        expect(problems(OK, { ...REQ, k: 51 }).join(' ')).toMatch(/k must be/);
    });
});

describe('role helpers', () => {
    it('list columns by role', () => {
        const roles = { 0: 'identifier', 1: 'quasi-identifier', 2: 'other', 3: 'quasi-identifier' } as const;
        expect(quasiIdentifiers(roles, 4)).toEqual([1, 3]);
        expect(identifierColumns(roles, 4)).toEqual([0]);
    });
});

describe('what a release attests', () => {
    it('states the measured property and the suppression, never legal anonymity', () => {
        expect(anonymityStatement(5, 'cells')).toBe('k-anonymity k=5 measured, local suppression applied');
        expect(anonymityStatement(5, 'rows')).toBe('k-anonymity k=5 measured, record suppression applied');
        expect(anonymityStatement(5, 'cells')).not.toMatch(/anonymi[sz]ed|anonymous/);
    });

    it('builds the audit record from the check (counts and names only)', () => {
        const check = {
            report: { min_group: 6 },
            claim: 'Measured: ...',
            suppression: { rows_suppressed: 4, cells_suppressed: 8, rows_dropped: 0 },
        } as unknown as ReleaseCheck;
        expect(anonymityAudit(REQ, ['dob', 'city'], check)).toEqual({
            k: 5,
            mode: 'cells',
            quasiIdentifiers: ['dob', 'city'],
            statement: 'k-anonymity k=5 measured, local suppression applied',
            claim: 'Measured: ...',
            minGroup: 6,
            rowsSuppressed: 4,
            cellsSuppressed: 8,
            rowsDropped: 0,
        });
    });
});

describe('worstOffenders', () => {
    it('ranks the column whose removal helps most first', () => {
        const report = {
            per_column: [
                { column: 0, rows_below_k_without: 9 },
                { column: 1, rows_below_k_without: 2 },
            ],
        };
        expect(worstOffenders(report, ['dob', 'city'])).toEqual(['city', 'dob']);
    });

    it('labels by table column index when the quasi-identifiers are not 0..n-1', () => {
        const report = {
            per_column: [
                { column: 1, rows_below_k_without: 0 },
                { column: 2, rows_below_k_without: 1 },
            ],
        };
        const labels = worstOffenders(report, ['id', 'age', 'city']);
        expect(labels).toEqual(['age', 'city']);
        expect(labels.join(' ')).not.toContain('undefined');
    });
});

describe('direct identifiers by detector', () => {
    const meta = [
        { index: 0, header: 'a', type: 'text', confidence: 0 },
        { index: 1, header: 'contact', type: 'email', confidence: 1 },
        { index: 2, header: 'ring', type: 'phone', confidence: 1 },
        { index: 3, header: 'born', type: 'date', confidence: 1 },
    ] as const;
    it('lists email, phone, card, ssn, url and ip columns', () => {
        expect(detectedIdentifierColumns(meta)).toEqual([1, 2]);
    });
    it('joins them with role Identifier, whatever the role says', () => {
        const roles = { 0: 'identifier', 1: 'other', 2: 'quasi-identifier', 3: 'quasi-identifier' } as const;
        expect(directIdentifierColumns(roles, 4, meta)).toEqual([0, 1, 2]);
    });
});

describe('direct identifiers by header', () => {
    const col = (index: number, header: string) => ({ index, header, type: 'text', confidence: 0 }) as const;
    it('counts a column whose cells the detector missed but whose header names an identifier', () => {
        const meta = [col(0, 'Email'), col(1, 'mobile'), col(2, 'company_name'), col(3, 'Full Name')];
        expect(detectedIdentifierColumns(meta)).toEqual([0, 1, 3]);
    });
    it('holds whatever role the user gave it', () => {
        const meta = [col(0, 'email'), col(1, 'city')];
        expect(directIdentifierColumns({ 0: 'other', 1: 'quasi-identifier' }, 2, meta)).toEqual([0]);
    });
    it('makes releaseProblems refuse it unless redacted', () => {
        const meta = [col(0, 'phone')];
        const request = { qi: [1], identifiers: detectedIdentifierColumns(meta), k: 5, mode: 'cells' as const };
        expect(releaseProblems({ headers: ['phone', 'age'], policies: { 0: { type: 'keep' } }, request })
            .some((p) => p.includes('Direct identifier'))).toBe(true);
        expect(releaseProblems({ headers: ['phone', 'age'], policies: { 0: { type: 'redact' } }, request })
            .some((p) => p.includes('Direct identifier'))).toBe(false);
    });
});

describe('release-allowed policies', () => {
    it('are all accepted by the gate and are the rungs the ladder uses', () => {
        for (const type of RELEASE_ALLOWED) expect(keepsRelinkability({ type })).toBe(false);
        for (const kind of ['date', 'numeric', 'other'] as const) {
            for (const r of ladderFor(kind)) expect(RELEASE_ALLOWED).toContain(r.policy.type);
        }
    });

    it('render the one wording in the gate message', () => {
        expect(releaseAllowedProse()).toBe('keep, redact, mask, year, age band and number range');
    });
});
