import * as v from 'valibot';
import type { CanonType, ColumnPolicy, PolicyType } from '../types/policy';
import {
    CANON_TYPE_STRINGS,
    POLICY_STRINGS,
    deprecatedPolicyReport,
    isDeprecatedPolicy,
} from '../types/policy';
import { isIsoDate, isWidth, takesReferenceDate, takesWidth } from './policy-params';

export interface PolicyColumnDoc {
    name: string;
    index: number;
    action: PolicyType;
    type?: CanonType;
    width?: number;
    reference_date?: string;
}

export interface PolicyDoc {
    version: 1;
    columns: PolicyColumnDoc[];
}

export const exportPolicyDoc = (
    headers: string[],
    policies: Record<number, ColumnPolicy>
): PolicyDoc => ({
    version: 1 as const,
    columns: headers.map((h, i) => {
        const p = policies[i];
        return {
            name: h,
            index: i,
            action: p?.type ?? 'keep',
            ...(p?.type === 'hash' && p.canon ? { type: p.canon } : {}),
            ...(p && takesWidth(p.type) && p.width !== undefined ? { width: p.width } : {}),
            ...(p && takesReferenceDate(p.type) && p.referenceDate
                ? { reference_date: p.referenceDate }
                : {}),
        };
    }),
});

export type PolicyParamsDoc = Pick<ColumnPolicy, 'width' | 'referenceDate'>;

export type PolicyApplier = (
    index: number,
    action: PolicyType,
    canon?: CanonType,
    params?: PolicyParamsDoc
) => void;

const NO_COLUMNS = 'policy.json must contain a "columns" array';

const DocSchema = v.object({ columns: v.array(v.unknown()) });

const EntryShape = v.object({
    index: v.optional(v.unknown()),
    name: v.optional(v.unknown()),
    action: v.string(),
});

const EntryValues = v.object({
    action: v.pipe(
        v.picklist(POLICY_STRINGS),
        v.check((p) => !isDeprecatedPolicy(p))
    ),
    type: v.optional(v.picklist(CANON_TYPE_STRINGS)),
    width: v.optional(v.custom<number>(isWidth)),
    reference_date: v.optional(v.custom<string>(isIsoDate)),
});

const MAX_REPORTED_CHARS = 64;

const shown = (x: unknown): string => {
    let s: string;
    try {
        s = String(x);
    } catch {
        s = typeof x;
    }
    return s.length > MAX_REPORTED_CHARS ? `${s.slice(0, MAX_REPORTED_CHARS)}…` : s;
};

const resolveColumn = (
    c: { index?: unknown; name?: unknown },
    headers: readonly string[]
): { col: number } | { error: string } | undefined => {
    if (typeof c.index === 'number') {
        const i = c.index;
        return Number.isSafeInteger(i) && i >= 0 && i < headers.length
            ? { col: i }
            : { error: `column index ${shown(i)} out of bounds (${headers.length} columns)` };
    }
    if (typeof c.name === 'string') {
        let i = headers.indexOf(c.name);
        if (i < 0) {
            const lower = c.name.toLowerCase();
            i = headers.findIndex((h) => h.toLowerCase() === lower);
        }
        return i >= 0 ? { col: i } : { error: `column "${shown(c.name)}" not found in headers` };
    }
    return undefined;
};

const reportOf = (issue: v.BaseIssue<unknown>): string => {
    const key = issue.path?.[0]?.key;
    if (key === 'action') {
        return issue.type === 'check'
            ? deprecatedPolicyReport(String(issue.input))
            : shown(issue.input);
    }
    return `${String(key)}:${shown(issue.input)}`;
};

export const importPolicyDoc = (
    json: unknown,
    headers: readonly string[],
    apply: PolicyApplier
): number => {
    const doc = v.safeParse(DocSchema, json);
    if (!doc.success) throw new Error(NO_COLUMNS);
    const version = (json as { version?: unknown }).version;
    if (version !== undefined && !(Number.isInteger(version) && (version as number) >= 0 && (version as number) <= 1)) {
        throw new Error(`unsupported policy.json version ${shown(version)} (this app reads version 1)`);
    }
    let applied = 0;
    const rejected: string[] = [];
    for (const c of doc.output.columns) {
        if (!v.is(EntryShape, c)) continue;
        const target = resolveColumn(c, headers);
        if (target === undefined) continue;
        const entry = v.safeParse(EntryValues, c, { abortEarly: true });
        if (!entry.success) {
            rejected.push(reportOf(entry.issues[0]));
            continue;
        }
        if ('error' in target) {
            rejected.push(target.error);
            continue;
        }
        const { action, type, width, reference_date: ref } = entry.output;
        const params: PolicyParamsDoc | undefined =
            width !== undefined || ref !== undefined
                ? {
                      ...(width !== undefined ? { width } : {}),
                      ...(ref !== undefined ? { referenceDate: ref } : {}),
                  }
                : undefined;
        apply(target.col, action, type, params);
        applied++;
    }
    if (rejected.length > 0) {
        throw new Error(`unknown policy.json value(s): ${[...new Set(rejected)].join(', ')}`);
    }
    if (applied === 0) {
        throw new Error(
            doc.output.columns.length === 0
                ? 'policy.json has an empty "columns" list: nothing to import'
                : 'policy.json has no usable columns: each needs a string "action" and a numeric "index" or a string "name"'
        );
    }
    return applied;
};
