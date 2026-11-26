import { anonymizeData } from './anonymize';
import { ensureWasm, k_anonymity_measure, k_anonymity_suppress } from './wasm';
import { ladderFor, planAnonymisation } from '../lib/anonymity-plan';
import type { AnonymityPlan, ColumnKind, PlanColumn, Rung } from '../lib/anonymity-plan';
import type { ColumnMetadata, Rows } from '../types/data';
import type { AnonymizeOpts, ColumnPolicy } from '../types/policy';
import type { AnonymityReport } from '../types/anonymity';

const str = (c: unknown): string => (c === null || c === undefined ? '' : String(c));

export const planAnonymity = async (
    data: Rows,
    headers: string[],
    metadata: ColumnMetadata[],
    opts: AnonymizeOpts,
    qi: number[],
    kinds: ColumnKind[],
    k: number,
    budget: number
): Promise<AnonymityPlan> => {
    await ensureWasm();
    const columns: PlanColumn[] = [];
    for (let i = 0; i < qi.length; i++) {
        const col = qi[i];
        const rungs: Rung[] = [];
        const values: string[][] = [];
        for (const rung of ladderFor(kinds[i] ?? 'other')) {
            if (rung.policy.type === 'keep') {
                rungs.push(rung);
                values.push(data.map((r) => str(r[col])));
                continue;
            }
            try {
                const policies: Record<number, ColumnPolicy> = { [col]: rung.policy };
                const { data: out } = await anonymizeData(data, headers, metadata, policies, () => {}, opts);
                rungs.push(rung);
                values.push(out.map((r) => str(r[col])));
            } catch {
                // This rung cannot run on this column: skip it.
            }
        }
        columns.push({ column: col, name: headers[col] ?? String(col), rungs, values });
    }
    const indexes = columns.map((_, i) => i);
    return planAnonymisation({
        columns,
        rows: data.length,
        k,
        budget,
        measure: (cols) => {
            const rows = data.map((_, r) => cols.map((c) => c[r]));
            const report = JSON.parse(
                k_anonymity_measure(JSON.stringify(rows), JSON.stringify(indexes), k)
            ) as AnonymityReport;
            return { rows: report.rows, rows_below_k: report.rows_below_k };
        },
    });
};

export interface AtRiskRow {
    row: number;
    values: string[];
}

export const atRiskRows = async (
    data: Rows,
    headers: string[],
    metadata: ColumnMetadata[],
    policies: Record<number, ColumnPolicy>,
    opts: AnonymizeOpts,
    qi: number[],
    k: number
): Promise<AtRiskRow[]> => {
    await ensureWasm();
    const { data: out } = await anonymizeData(data, headers, metadata, policies, () => {}, opts);
    const strs = out.map((r) => r.map(str));
    const res = JSON.parse(k_anonymity_suppress(JSON.stringify(strs), JSON.stringify(qi), k, 'rows')) as {
        rows: string[][];
    };
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((c, n) => c === b[n]);
    const risky: AtRiskRow[] = [];
    let j = 0;
    for (let i = 0; i < strs.length; i++) {
        if (j < res.rows.length && same(strs[i], res.rows[j])) j++;
        else risky.push({ row: i, values: qi.map((c) => strs[i][c]) });
    }
    return risky;
};
