import { policyLabel } from './policy-ui';
import { keepsRelinkability, RELEASE_ALLOWED } from './anonymity';
import type { ReleaseAllowed } from './anonymity';
import type { ColumnPolicy } from '../types/policy';

export const DEFAULT_SUPPRESSION_BUDGET = 0.1;
export const MAX_SUPPRESSION_BUDGET = 0.5;

export type ColumnKind = 'date' | 'numeric' | 'other';

export interface Rung {
    policy: ColumnPolicy;
    cost: number;
}

const rung = (type: ReleaseAllowed, cost: number, width?: number): Rung => {
    if (!RELEASE_ALLOWED.includes(type)) throw new Error(`${type} is not release-allowed`);
    return { policy: width === undefined ? { type } : { type, width }, cost };
};

export const ladderFor = (kind: ColumnKind): Rung[] => {
    switch (kind) {
        case 'date':
            return [rung('keep', 0), rung('year', 1), rung('redact', 3)];
        case 'numeric':
            return [rung('keep', 0), rung('bucket', 1), rung('bucket', 2, 100), rung('redact', 4)];
        default:
            return [rung('keep', 0), rung('redact', 3)];
    }
};

export interface PlanColumn {
    column: number;
    name: string;
    rungs: Rung[];
    values: string[][];
}

export type Measure = (columns: string[][]) => { rows: number; rows_below_k: number };

export interface PlanStep {
    column: number;
    name: string;
    policy: ColumnPolicy;
    dropped: boolean;
}

export type PlanFailure = 'no-columns' | 'too-few-rows';

export interface AnonymityPlan {
    k: number;
    budget: number;
    rows: number;
    achievable: boolean;
    failure?: PlanFailure;
    levels: number[];
    steps: PlanStep[];
    rowsBelowK: number;
    allowedRows: number;
}

interface Candidate {
    i: number;
    after: number;
    ratio: number;
    cost: number;
}

const met = (below: number, rows: number, allowed: number): boolean => below <= allowed && below < rows;

export const planAnonymisation = (input: {
    columns: PlanColumn[];
    rows: number;
    k: number;
    budget?: number;
    measure: Measure;
}): AnonymityPlan => {
    const { columns, rows, k, measure } = input;
    const budget = Math.min(MAX_SUPPRESSION_BUDGET, Math.max(0, input.budget ?? DEFAULT_SUPPRESSION_BUDGET));
    const allowed = Math.floor(budget * rows);
    const base = { k, budget, rows, allowedRows: allowed };
    if (columns.length === 0) {
        return { ...base, achievable: false, failure: 'no-columns', levels: [], steps: [], rowsBelowK: 0 };
    }
    const at = (levels: number[]): number =>
        measure(columns.map((c, i) => c.values[levels[i]])).rows_below_k;
    const top = columns.map((c) => c.rungs.length - 1);
    let levels = columns.map(() => 0);
    let below = at(levels);

    while (!met(below, rows, allowed)) {
        let best: Candidate | null = null;
        for (let i = 0; i < columns.length; i++) {
            const c = columns[i];
            if (levels[i] >= top[i]) continue;
            const next = levels.slice();
            next[i] += 1;
            const after = at(next);
            const cost = Math.max(1, c.rungs[next[i]].cost - c.rungs[levels[i]].cost);
            const ratio = (below - after) / cost;
            const better =
                best === null ||
                ratio > best.ratio ||
                (ratio === best.ratio &&
                    (cost < best.cost || (cost === best.cost && after < best.after)));
            if (better) best = { i, after, ratio, cost };
        }
        if (best === null) break;
        const chosen: Candidate = best;
        levels = levels.map((l, i) => (i === chosen.i ? l + 1 : l));
        below = chosen.after;
    }

    const achievable = met(below, rows, allowed);
    if (achievable) {
        let changed = true;
        while (changed) {
            changed = false;
            for (let i = 0; i < columns.length; i++) {
                if (levels[i] === 0) continue;
                const down = levels.slice();
                down[i] -= 1;
                const after = at(down);
                if (met(after, rows, allowed)) {
                    levels = down;
                    below = after;
                    changed = true;
                }
            }
        }
    }

    const steps: PlanStep[] = columns
        .map((c, i) => ({ c, level: levels[i] }))
        .filter((x) => x.level > 0)
        .map(({ c, level }) => ({
            column: c.column,
            name: c.name,
            policy: c.rungs[level].policy,
            dropped: level === c.rungs.length - 1,
        }));
    return {
        ...base,
        achievable,
        failure: achievable ? undefined : rows < k ? 'too-few-rows' : undefined,
        levels,
        steps,
        rowsBelowK: below,
    };
};

const q = (names: string[]): string => names.map((n) => `"${n}"`).join(', ');

const stepText = (s: PlanStep): string =>
    s.dropped ? `drop "${s.name}" (redact)` : `generalise "${s.name}" to ${policyLabel(s.policy.type).toLowerCase()}`;

export const describePlan = (plan: AnonymityPlan): string[] => {
    const lines: string[] = [];
    const pct = plan.rows === 0 ? 0 : Math.round((plan.rowsBelowK / plan.rows) * 1000) / 10;
    if (plan.failure === 'no-columns') {
        return ['Mark at least one column as a Quasi-identifier first: there is nothing to measure without one.'];
    }
    if (plan.failure === 'too-few-rows') {
        return [
            `Not possible: the file has ${plan.rows} row${plan.rows === 1 ? '' : 's'}, too few for every group to reach k=${plan.k}. ` +
                `The closest state drops every quasi-identifier column (${q(plan.steps.map((s) => s.name))}). ` +
                'Lower k or add rows.',
        ];
    }
    if (!plan.achievable) {
        lines.push(
            `Not possible within the ${Math.round(plan.budget * 100)}% suppression budget, even after generalising every quasi-identifier as far as it goes.`
        );
    }
    const dropped = plan.steps.filter((s) => s.dropped);
    const general = plan.steps.filter((s) => !s.dropped);
    if (plan.steps.length === 0) {
        lines.push(
            plan.rowsBelowK === 0
                ? `Possible as it stands: every combination of the quasi-identifiers is shared by at least ${plan.k} rows.`
                : `Possible with no column changes: suppress the ${plan.rowsBelowK} rows (${pct}%) in groups smaller than k=${plan.k}.`
        );
    } else {
        const verbs = [...general, ...dropped].map(stepText);
        let line = `${plan.achievable ? 'Possible' : 'Closest'}: ${verbs.join('; ')}.`;
        if (plan.rowsBelowK === 0) line += ` Then every group has at least ${plan.k} rows and nothing needs suppressing.`;
        else
            line += ` Then ${plan.rowsBelowK} row${plan.rowsBelowK === 1 ? ' is' : 's are'} still in a group smaller than k=${plan.k}: ` +
                `suppress ${plan.rowsBelowK === 1 ? 'it' : 'them'} (${pct}% of rows).`;
        lines.push(line);
        if (dropped.length > 0 && general.length === 0 && dropped.length === plan.levels.length && plan.achievable) {
            lines.push(
                `Every combination of these columns is too rare, so only dropping ${dropped.length === 1 ? 'it' : 'them all'} reaches k. ` +
                    'Mark fewer columns as quasi-identifiers, lower k or raise the budget for a more useful file.'
            );
        } else if (dropped.length > 0) {
            lines.push(`At least ${dropped.length === 1 ? 'this column has' : 'these columns have'} to go: ${q(dropped.map((s) => s.name))}.`);
        }
    }
    return lines;
};

export const policiesForPlan = (input: {
    plan: AnonymityPlan;
    qiColumns: number[];
    identifiers: number[];
    policies: Record<number, ColumnPolicy>;
    count: number;
}): Record<number, ColumnPolicy> => {
    const { plan, qiColumns, identifiers, policies, count } = input;
    const next: Record<number, ColumnPolicy> = { ...policies };
    const qiSet = new Set(qiColumns);
    const idSet = new Set(identifiers);
    for (const col of qiColumns) {
        const step = plan.steps.find((s) => s.column === col);
        next[col] = step ? { ...step.policy } : { type: 'keep' };
    }
    for (let i = 0; i < count; i++) {
        if (idSet.has(i)) next[i] = { type: 'redact' };
        else if (!qiSet.has(i)) next[i] = keepsRelinkability(policies[i]) ? { type: 'redact' } : { type: 'keep' };
    }
    return next;
};
