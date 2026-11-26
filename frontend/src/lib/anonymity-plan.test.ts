import { describe, expect, it } from 'vitest';
import {
    describePlan,
    ladderFor,
    planAnonymisation,
    policiesForPlan,
} from './anonymity-plan';
import type { Measure, PlanColumn } from './anonymity-plan';

const measure: Measure = (cols) => {
    const rows = cols[0]?.length ?? 0;
    const counts = new Map<string, number>();
    for (let r = 0; r < rows; r++) {
        const key = JSON.stringify(cols.map((c) => c[r]));
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let below = 0;
    for (const n of counts.values()) if (n < 3) below += n;
    return { rows, rows_below_k: below };
};

const col = (column: number, name: string, kind: 'date' | 'other', raw: string[], mid?: string[]): PlanColumn => {
    const rungs = ladderFor(kind);
    const values = [raw];
    if (kind === 'date') values.push(mid ?? raw.map((v) => v.slice(0, 4)));
    values.push(raw.map(() => '[REDACTED]'));
    return { column, name, rungs, values };
};

const dates = ['1980-01-01', '1980-05-05', '1980-09-09', '1990-02-02', '1990-03-03', '1990-04-04'];
const cities = ['A', 'B', 'C', 'A', 'B', 'C'];

describe('planAnonymisation', () => {
    it('generalises a date to year when that is enough', () => {
        const plan = planAnonymisation({
            columns: [col(2, 'dob', 'date', dates)], rows: 6, k: 3, budget: 0, measure,
        });
        expect(plan.achievable).toBe(true);
        expect(plan.steps.map((s) => [s.name, s.policy.type, s.dropped])).toEqual([['dob', 'year', false]]);
        expect(plan.rowsBelowK).toBe(0);
    });

    it('drops only the column that must go, and is deterministic', () => {
        const columns = [col(0, 'dob', 'date', dates), col(1, 'city', 'other', cities)];
        const a = planAnonymisation({ columns, rows: 6, k: 3, budget: 0, measure });
        const b = planAnonymisation({ columns, rows: 6, k: 3, budget: 0, measure });
        expect(a).toEqual(b);
        expect(a.achievable).toBe(true);
        expect(a.steps.map((s) => [s.name, s.policy.type])).toEqual(
            expect.arrayContaining([['city', 'redact']])
        );
        expect(a.rowsBelowK).toBe(0);
    });

    it('prefers suppression within the budget over dropping a column', () => {
        const raw = ['x', 'x', 'x', 'y'];
        const plan = planAnonymisation({
            columns: [col(0, 'c', 'other', raw)], rows: 4, k: 3, budget: 0.25, measure,
        });
        expect(plan.achievable).toBe(true);
        expect(plan.steps).toEqual([]);
        expect(plan.rowsBelowK).toBe(1);
        expect(describePlan(plan)[0]).toMatch(/suppress the 1 rows|suppress the 1 row/);
    });

    it('says not possible when there are fewer rows than k', () => {
        const plan = planAnonymisation({
            columns: [col(0, 'c', 'other', ['a', 'b'])], rows: 2, k: 3, budget: 0.1, measure,
        });
        expect(plan.achievable).toBe(false);
        expect(plan.failure).toBe('too-few-rows');
        expect(describePlan(plan)[0]).toMatch(/Not possible/);
    });

    it('asks for a quasi-identifier when there is none', () => {
        const plan = planAnonymisation({ columns: [], rows: 5, k: 3, measure });
        expect(plan.failure).toBe('no-columns');
        expect(describePlan(plan)[0]).toMatch(/Mark at least one column/);
    });
});

describe('policiesForPlan', () => {
    it('sets the plan rungs, redacts kept identifiers and relinkable columns, keeps the rest', () => {
        const plan = planAnonymisation({
            columns: [col(1, 'dob', 'date', dates)], rows: 6, k: 3, budget: 0, measure,
        });
        const next = policiesForPlan({
            plan,
            qiColumns: [1],
            identifiers: [0],
            policies: { 0: { type: 'keep' }, 1: { type: 'keep' }, 2: { type: 'hash' }, 3: { type: 'mask' } },
            count: 4,
        });
        expect(next[0].type).toBe('redact');
        expect(next[1].type).toBe('year');
        expect(next[2].type).toBe('redact');
        expect(next[3].type).toBe('keep');
    });

    it('gives the same policies from different starting states', () => {
        const plan = planAnonymisation({
            columns: [col(1, 'dob', 'date', dates)], rows: 6, k: 3, budget: 0, measure,
        });
        const from = (policies: Parameters<typeof policiesForPlan>[0]['policies']) =>
            policiesForPlan({ plan, qiColumns: [1], identifiers: [0], policies, count: 4 });
        const fresh = from({});
        const stale = from({
            0: { type: 'mask' }, 1: { type: 'redact' }, 2: { type: 'mask' }, 3: { type: 'year' },
        });
        expect(stale).toEqual(fresh);
        expect(fresh[2]).toEqual({ type: 'keep' });
        expect(fresh[3]).toEqual({ type: 'keep' });
    });
});

describe('policiesForPlan: direct identifiers never survive', () => {
    it('redacts identifiers left on mask, hash or keep', () => {
        const plan = planAnonymisation({
            columns: [col(1, 'dob', 'date', dates)], rows: 6, k: 3, budget: 0, measure,
        });
        const next = policiesForPlan({
            plan,
            qiColumns: [1],
            identifiers: [0, 2, 3, 4],
            policies: {
                0: { type: 'mask' }, 1: { type: 'keep' }, 2: { type: 'mask-email' },
                3: { type: 'hash' }, 4: { type: 'keep' }, 5: { type: 'mask' },
            },
            count: 6,
        });
        for (const i of [0, 2, 3, 4]) expect(next[i].type).toBe('redact');
        expect(next[5].type).toBe('keep');
    });
});
