import { create } from 'zustand';
import { retype } from '../lib/policy-params';
import { columnType, isNumericColumn, suggestRoles, suggestedPolicyForRole } from '../lib/roles';
import type { ColumnRole } from '../lib/roles';
import { DEFAULT_K, DEFAULT_SUPPRESS_MODE, MAX_K, MIN_K } from '../types/anonymity';
import type { SuppressMode } from '../types/anonymity';
import type { ColumnMetadata, RowData } from '../types/data';
import type { CanonType, ColumnPolicy, PolicyType, TokenEncoding } from '../types/policy';

interface PolicyState {
    policies: Record<number, ColumnPolicy>;
    headers: string[];
    data: RowData[];
    metadata: ColumnMetadata[];
    dataset: string;
    tokenEncoding: TokenEncoding;
    excludedRows: ReadonlySet<number>;
    roles: Record<number, ColumnRole>;
    anonymousRelease: boolean;
    k: number;
    suppressMode: SuppressMode;
    setRole: (colIndex: number, role: ColumnRole) => void;
    applyRolePolicies: () => number;
    setAnonymousRelease: (on: boolean) => void;
    setK: (k: number) => void;
    setSuppressMode: (m: SuppressMode) => void;
    setPolicy: (colIndex: number, type: PolicyType) => void;
    setPolicies: (
        colIndexes: number[],
        type: PolicyType,
        params?: Pick<ColumnPolicy, 'width' | 'referenceDate'>
    ) => void;
    setPolicyMap: (next: Record<number, ColumnPolicy>, anonymousRelease?: boolean) => void;
    excludeRows: (rowIndexes: Iterable<number>) => void;
    restoreState: (saved: {
        policies: Record<number, ColumnPolicy>;
        excludedRows: ReadonlySet<number>;
        anonymousRelease: boolean;
    }) => void;
    setCanon: (colIndex: number, canon: CanonType) => void;
    setParams: (colIndex: number, params: Pick<ColumnPolicy, 'width' | 'referenceDate'>) => void;
    setDataset: (v: string) => void;
    setTokenEncoding: (t: TokenEncoding) => void;
    initializePolicies: (count: number) => void;
    toggleRowExclusion: (rowIndex: number) => void;
    clearRowExclusions: () => void;
    setFileData: (headers: string[], data: RowData[], metadata: ColumnMetadata[]) => void;
    clearData: () => void;
}

const definedParams = (params?: Pick<ColumnPolicy, 'width' | 'referenceDate'>) =>
    Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined));

export const useDatasetStore = create<PolicyState>((set) => ({
    policies: {},
    headers: [],
    data: [],
    metadata: [],
    dataset: '',
    tokenEncoding: 'hex',
    excludedRows: new Set(),
    roles: {},
    anonymousRelease: false,
    k: DEFAULT_K,
    suppressMode: DEFAULT_SUPPRESS_MODE,
    setRole: (colIndex, role) => set((state) => ({ roles: { ...state.roles, [colIndex]: role } })),
    applyRolePolicies: () => {
        let changed = 0;
        set((state) => {
            const next = { ...state.policies };
            state.headers.forEach((_, i) => {
                const role = state.roles[i];
                if (!role) return;
                const type = columnType(state.metadata, state.data, i);
                const suggested = suggestedPolicyForRole(role, type, isNumericColumn(state.data, i));
                if ((state.policies[i]?.type ?? 'keep') === suggested.type) return;
                next[i] = retype(suggested.type, state.policies[i]);
                changed++;
            });
            return { policies: next };
        });
        return changed;
    },
    setAnonymousRelease: (on) => set(() => ({ anonymousRelease: on })),
    setK: (k) => set(() => ({
        k: Math.min(MAX_K, Math.max(MIN_K, Number.isFinite(k) ? Math.round(k) : DEFAULT_K)),
    })),
    setSuppressMode: (m) => set(() => ({ suppressMode: m })),
    setPolicy: (colIndex, type) => set((state) => ({
        policies: { ...state.policies, [colIndex]: retype(type, state.policies[colIndex]) }
    })),
    setPolicies: (colIndexes, type, params) => set((state) => {
        const next = { ...state.policies };
        for (const i of colIndexes) {
            next[i] = { ...retype(type, state.policies[i]), ...definedParams(params) };
        }
        return { policies: next };
    }),
    setPolicyMap: (next, anonymousRelease) => set((state) => {
        const policies: Record<number, ColumnPolicy> = {};
        for (const [key, p] of Object.entries(next)) {
            const i = Number(key);
            policies[i] = { ...retype(p.type, state.policies[i]), ...definedParams({ width: p.width, referenceDate: p.referenceDate }) };
        }
        return anonymousRelease === undefined ? { policies } : { policies, anonymousRelease };
    }),
    excludeRows: (rowIndexes) => set((state) => ({
        excludedRows: new Set([...state.excludedRows, ...rowIndexes]),
    })),
    restoreState: (saved) => set(() => ({
        policies: { ...saved.policies },
        excludedRows: new Set(saved.excludedRows),
        anonymousRelease: saved.anonymousRelease,
    })),
    setParams: (colIndex, params) => set((state) => ({
        policies: {
            ...state.policies,
            [colIndex]: { ...state.policies[colIndex], ...params }
        }
    })),
    setCanon: (colIndex, canon) => set((state) => ({
        policies: {
            ...state.policies,
            [colIndex]: { ...state.policies[colIndex], canon: canon === 'auto' ? undefined : canon }
        }
    })),
    setDataset: (v) => set(() => ({ dataset: v })),
    setTokenEncoding: (t) => set(() => ({ tokenEncoding: t })),
    initializePolicies: (count) => set(() => {
        const initial: Record<number, ColumnPolicy> = {};
        for (let i = 0; i < count; i++) {
            initial[i] = { type: 'keep' };
        }
        return { policies: initial };
    }),
    toggleRowExclusion: (rowIndex) => set((state) => {
        const next = new Set(state.excludedRows);
        if (next.has(rowIndex)) {
            next.delete(rowIndex);
        } else {
            next.add(rowIndex);
        }
        return { excludedRows: next };
    }),
    clearRowExclusions: () => set(() => ({ excludedRows: new Set() })),
    setFileData: (headers, data, metadata) => set(() => ({
        headers,
        data,
        metadata,
        excludedRows: new Set(),
        roles: suggestRoles(headers, metadata, data),
        anonymousRelease: false,
    })),
    clearData: () => set(() => ({
        headers: [],
        data: [],
        metadata: [],
        policies: {},
        excludedRows: new Set(),
        roles: {},
        anonymousRelease: false,
    })),
}));
