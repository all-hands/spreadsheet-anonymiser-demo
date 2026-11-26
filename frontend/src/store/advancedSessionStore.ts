import { create } from 'zustand';
import { revokeArtifacts } from '../lib/download';
import type { Artifact } from '../lib/download';
import type { FileParse } from '../hooks/useFileLoad';
import type { KeyStatus } from '../hooks/useKeyedSession';
import type { MeasureResult } from '../types/anonymity';
import type { ColumnPolicy } from '../types/policy';
import { DEFAULT_SUPPRESSION_BUDGET, MAX_SUPPRESSION_BUDGET } from '../lib/anonymity-plan';
import type { AnonymityPlan } from '../lib/anonymity-plan';
import { useDatasetStore } from './datasetStore';
import { useAuditStore } from './auditStore';

export interface Measurement {
    key: string;
    value: MeasureResult;
}

export interface PlanResult {
    key: string;
    value: AnonymityPlan;
}

export interface UndoSnapshot {
    label: string;
    policies: Record<number, ColumnPolicy>;
    excludedRows: ReadonlySet<number>;
    anonymousRelease: boolean;
}

interface AdvancedSessionState {
    file: File | null;
    parse: FileParse | null;
    status: string;
    busy: boolean;
    artifacts: Artifact[];
    policyArtifacts: Artifact[];
    measurement: Measurement | null;
    plan: PlanResult | null;
    suppressionBudget: number;
    undo: UndoSnapshot | null;
    salt: Uint8Array | null;
    keyStatus: KeyStatus;
    loadSeq: number;
    keyEpoch: number;
    beginKeyChange: (status: KeyStatus) => number;
    setStatus: (msg: string) => void;
    setBusy: (busy: boolean) => void;
    setParse: (parse: FileParse | null) => void;
    setMeasurement: (m: Measurement | null) => void;
    setPlan: (p: PlanResult | null) => void;
    setSuppressionBudget: (b: number) => void;
    snapshot: (label: string) => void;
    undoLast: () => void;
    setKey: (salt: Uint8Array | null, status: KeyStatus) => void;
    replaceArtifacts: (produced: Artifact[]) => void;
    replacePolicyArtifacts: (produced: Artifact[]) => void;
    beginFile: (file: File) => void;
    clearSession: () => void;
}

const initial = {
    file: null,
    parse: null,
    status: '',
    busy: false,
    artifacts: [] as Artifact[],
    policyArtifacts: [] as Artifact[],
    measurement: null,
    plan: null,
    undo: null as UndoSnapshot | null,
};

export const useAdvancedSessionStore = create<AdvancedSessionState>((set, get) => ({
    ...initial,
    suppressionBudget: DEFAULT_SUPPRESSION_BUDGET,
    salt: null,
    keyStatus: 'off',
    loadSeq: 0,
    keyEpoch: 0,
    setStatus: (status) => set({ status }),
    setBusy: (busy) => set({ busy }),
    setParse: (parse) => set({ parse }),
    setMeasurement: (measurement) => set({ measurement }),
    setPlan: (plan) => set({ plan }),
    setSuppressionBudget: (b) =>
        set({ suppressionBudget: Math.min(MAX_SUPPRESSION_BUDGET, Math.max(0, Number.isFinite(b) ? b : DEFAULT_SUPPRESSION_BUDGET)) }),
    snapshot: (label) => {
        const d = useDatasetStore.getState();
        set({
            undo: {
                label,
                policies: { ...d.policies },
                excludedRows: new Set(d.excludedRows),
                anonymousRelease: d.anonymousRelease,
            },
        });
    },
    undoLast: () => {
        const u = get().undo;
        if (!u) return;
        useDatasetStore.getState().restoreState(u);
        set({ undo: null });
    },
    setKey: (salt, keyStatus) => set({ salt, keyStatus }),
    beginKeyChange: (status) => {
        const keyEpoch = get().keyEpoch + 1;
        set(status === 'off' ? { keyEpoch, keyStatus: status, salt: null } : { keyEpoch, keyStatus: status });
        return keyEpoch;
    },
    replaceArtifacts: (produced) => {
        revokeArtifacts(get().artifacts);
        set({ artifacts: produced });
    },
    replacePolicyArtifacts: (produced) => {
        revokeArtifacts(get().policyArtifacts);
        set({ policyArtifacts: produced });
    },
    beginFile: (file) => {
        revokeArtifacts(get().artifacts);
        revokeArtifacts(get().policyArtifacts);
        useDatasetStore.getState().clearData();
        useAuditStore.getState().clearCurrentLog();
        set({ ...initial, file, status: get().status, busy: get().busy, loadSeq: get().loadSeq + 1 });
    },
    clearSession: () => {
        revokeArtifacts(get().artifacts);
        revokeArtifacts(get().policyArtifacts);
        useDatasetStore.getState().clearData();
        useAuditStore.getState().clearCurrentLog();
        set({ ...initial, loadSeq: get().loadSeq + 1 });
    },
}));
