import { useDatasetStore } from '../store/datasetStore';
import { useAdvancedSessionStore } from '../store/advancedSessionStore';
import { createWorker } from './worker-client';
import { filterRows, optsOf } from './pipeline-common';
import { directIdentifierColumns, quasiIdentifiers, releaseProblems } from './anonymity';
import { policiesForPlan } from './anonymity-plan';
import type { AnonymityPlan, ColumnKind } from './anonymity-plan';
import type { MeasureResult } from '../types/anonymity';
import { columnType, isNumericColumn } from './roles';
import type { ColumnRole } from './roles';
import type { ColumnPolicy } from '../types/policy';

export const planKey = (): string => {
    const s = useDatasetStore.getState();
    const budget = useAdvancedSessionStore.getState().suppressionBudget;
    return JSON.stringify([
        quasiIdentifiers(s.roles, s.headers.length), s.k, [...s.excludedRows],
        s.dataset, s.tokenEncoding, s.headers, budget,
    ]);
};

type DatasetSnapshot = ReturnType<typeof useDatasetStore.getState>;

export const measureInputKey = (
    s: Pick<DatasetSnapshot, 'policies' | 'roles' | 'headers' | 'k' | 'excludedRows' | 'dataset' | 'tokenEncoding'>
): string =>
    JSON.stringify([
        s.policies, quasiIdentifiers(s.roles, s.headers.length), s.k, [...s.excludedRows],
        s.dataset, s.tokenEncoding, s.headers,
    ]);

export const measureNow = async (): Promise<MeasureResult | null> => {
    const st = useDatasetStore.getState();
    const qi = quasiIdentifiers(st.roles, st.headers.length);
    if (qi.length === 0) return null;
    const key = measureInputKey(st);
    const parse = filterRows({ headers: st.headers, data: st.data, metadata: st.metadata }, st.excludedRows);
    const value = await createWorker().measureAnonymity(
        parse.data, parse.headers, parse.metadata, st.policies,
        optsOf({ dataset: st.dataset, tokenEncoding: st.tokenEncoding }), qi, st.k
    );
    useAdvancedSessionStore.getState().setMeasurement({ key, value });
    return value;
};

export const computePlan = async (): Promise<AnonymityPlan> => {
    const s = useDatasetStore.getState();
    const session = useAdvancedSessionStore.getState();
    const ids = directIdentifierColumns(s.roles, s.headers.length, s.metadata);
    const qi = quasiIdentifiers(s.roles, s.headers.length).filter((i) => !ids.includes(i));
    const kinds: ColumnKind[] = qi.map((i) =>
        columnType(s.metadata, s.data, i) === 'date' ? 'date' : isNumericColumn(s.data, i) ? 'numeric' : 'other'
    );
    const key = planKey();
    const parse = filterRows({ headers: s.headers, data: s.data, metadata: s.metadata }, s.excludedRows);
    const plan = await createWorker().planAnonymity(
        parse.data, parse.headers, parse.metadata,
        optsOf({ dataset: s.dataset, tokenEncoding: s.tokenEncoding }),
        qi, kinds, s.k, session.suppressionBudget
    );
    session.setPlan({ key, value: plan });
    return plan;
};

export const applyPlan = (plan: AnonymityPlan, label = 'Optimal anonymisation'): { changed: number; problems: string[] } => {
    const s = useDatasetStore.getState();
    const session = useAdvancedSessionStore.getState();
    const ids = directIdentifierColumns(s.roles, s.headers.length, s.metadata);
    const qi = quasiIdentifiers(s.roles, s.headers.length);
    const next = policiesForPlan({
        plan,
        qiColumns: qi.filter((i) => !ids.includes(i)),
        identifiers: ids,
        policies: s.policies,
        count: s.headers.length,
    });
    const changed = s.headers.filter((_, i) => (next[i]?.type ?? 'keep') !== (s.policies[i]?.type ?? 'keep')
        || next[i]?.width !== s.policies[i]?.width).length;
    session.snapshot(label);
    s.setPolicyMap(next, true);
    const problems = releaseProblems({
        headers: s.headers,
        policies: next,
        request: { qi, identifiers: ids, k: s.k, mode: s.suppressMode },
    });
    return { changed, problems };
};

const outcomeText = (
    changed: number,
    left: string[],
    value: MeasureResult | null,
    achievable: boolean
): string => {
    const cols = `${changed} column${changed === 1 ? '' : 's'}`;
    const outcome = value
        ? value.report.rows_below_k === 0
            ? `Measured again: 0 rows below k=${value.report.k}.`
            : `Measured again: ${value.report.rows_below_k} row${value.report.rows_below_k === 1 ? '' : 's'} below k=${value.report.k}` +
              (achievable ? '; the release suppresses them.' : '; this is the closest state, the plan says what remains.')
        : '';
    return left.length === 0
        ? `Applied: ${cols} changed and Anonymous release is on. ${outcome}`
        : `Applied the closest state (${cols} changed). ${outcome} Still blocking: ${left.join(' ')}`;
};

export const applyOptimal = async (
    opts: { plan?: AnonymityPlan | null; label?: string } = {}
): Promise<string> => {
    const use = opts.plan ?? (await computePlan());
    const { changed, problems } = applyPlan(use, opts.label);
    const value = await measureNow();
    return outcomeText(changed, problems, value, use.achievable);
};

export const ignoreAtRiskRows = (rows: ReadonlySet<number>): void => {
    useAdvancedSessionStore.getState().snapshot('Ignore at-risk rows');
    useDatasetStore.getState().excludeRows(rows);
};

export const applyPseudonymisePreset = (): number => {
    const s = useDatasetStore.getState();
    const freeText: Record<number, boolean> = {};
    s.headers.forEach((_, i) => {
        freeText[i] = isFreeTextColumn(s.data.map((r) => r[i]));
    });
    const next = pseudonymisePolicies({ roles: s.roles, freeText, count: s.headers.length });
    const changed = s.headers.filter((_, i) => (s.policies[i]?.type ?? 'keep') !== next[i].type).length;
    useAdvancedSessionStore.getState().snapshot('Pseudonymise preset');
    s.setPolicyMap(next, false);
    return changed;
};

export const pseudonymisePolicies = (input: {
    roles: Record<number, ColumnRole>;
    freeText: Record<number, boolean>;
    count: number;
}): Record<number, ColumnPolicy> => {
    const out: Record<number, ColumnPolicy> = {};
    for (let i = 0; i < input.count; i++) {
        const role = input.roles[i];
        if (role === 'identifier') out[i] = { type: 'hash' };
        else if (input.freeText[i]) out[i] = { type: 'redact' };
        else out[i] = { type: 'keep' };
    }
    return out;
};

export const isFreeTextColumn = (cells: readonly unknown[]): boolean => {
    const texts = cells.map((c) => (c === null || c === undefined ? '' : String(c).trim())).filter(Boolean);
    if (texts.length === 0) return false;
    const long = texts.filter((t) => t.length >= 40 && /\s/.test(t)).length;
    return long / texts.length >= 0.3;
};
