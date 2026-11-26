import { anonymizeData } from './anonymize';
import {
    ensureWasm,
    k_anonymity_claim,
    k_anonymity_measure,
    k_anonymity_suppress,
    suppressed_cell_marker,
} from './wasm';
import type { ColumnMetadata, Rows } from '../types/data';
import type { AnonymizeOpts, ColumnPolicy } from '../types/policy';
import type {
    AnonymityReport,
    MeasureResult,
    ReleaseCheck,
    SuppressMode,
    SuppressionSummary,
} from '../types/anonymity';

const asStrings = (rows: Rows): string[][] =>
    rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c))));

const measure = (rows: string[][], qi: number[], k: number): AnonymityReport =>
    JSON.parse(k_anonymity_measure(JSON.stringify(rows), JSON.stringify(qi), k)) as AnonymityReport;

const claimFor = (report: AnonymityReport, names: string[]): string =>
    k_anonymity_claim(JSON.stringify(report), JSON.stringify(names));

export const measureAnonymity = async (
    data: Rows,
    headers: string[],
    metadata: ColumnMetadata[],
    policies: Record<number, ColumnPolicy>,
    opts: AnonymizeOpts,
    qi: number[],
    k: number,
    onProgress: (msg: string) => void = () => {}
): Promise<MeasureResult> => {
    await ensureWasm();
    const { data: out } = await anonymizeData(data, headers, metadata, policies, onProgress, opts);
    const report = measure(asStrings(out), qi, k);
    return { report, claim: claimFor(report, qi.map((i) => headers[i] ?? String(i))) };
};

const retype = (
    original: Rows,
    suppressed: string[][],
    qi: number[],
    mode: SuppressMode,
    marker: string
): Rows => {
    const strs = asStrings(original);
    if (mode === 'cells') {
        return original.map((row, i) => {
            const copy = row.slice();
            for (const q of qi) if (suppressed[i][q] === marker && strs[i][q] !== marker) copy[q] = marker;
            return copy;
        });
    }
    const kept: Rows = [];
    let j = 0;
    for (let i = 0; i < original.length && j < suppressed.length; i++) {
        if (strs[i].length === suppressed[j].length && strs[i].every((c, n) => c === suppressed[j][n])) {
            kept.push(original[i]);
            j++;
        }
    }
    return kept;
};

export const suppressForRelease = async (
    data: Rows,
    headers: string[],
    qi: number[],
    k: number,
    mode: SuppressMode
): Promise<{ data: Rows; check: ReleaseCheck }> => {
    await ensureWasm();
    const strs = asStrings(data);
    const before = measure(strs, qi, k);
    const res = JSON.parse(k_anonymity_suppress(JSON.stringify(strs), JSON.stringify(qi), k, mode)) as {
        rows: string[][];
        suppression: SuppressionSummary;
    };
    const marker = suppressed_cell_marker();
    const out = retype(data, res.rows, qi, mode, marker);
    const informative = res.rows.filter((r) => !qi.every((c) => r[c] === marker));
    const report = measure(informative, qi, k);
    const names = qi.map((i) => headers[i] ?? String(i));
    return {
        data: out,
        check: {
            before,
            report,
            claim: claimFor(report, names),
            suppression: res.suppression,
            passed: report.rows > 0 && report.satisfied,
        },
    };
};
