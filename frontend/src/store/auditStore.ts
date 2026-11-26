import { create } from 'zustand';
import type { AuditLog, AuditLogEntry, AuditSummary } from '../types/audit';
import { generateAuditSummary } from '../types/audit';
import type { AnonymityAudit } from '../types/anonymity';

const generateId = () => crypto.randomUUID();

interface AuditState {
    currentLog: AuditLog | null;

    startNewLog: (filename: string, fileSize: number, totalRows: number, totalColumns: number, fileHash?: string) => string;
    addEntry: (entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) => void;
    setAnonymity: (anonymity: AnonymityAudit) => void;
    completeLog: () => void;
    failLog: (errorMessage: string) => void;
    clearCurrentLog: () => void;
    getLog: () => AuditLog | null;
    getSummary: () => AuditSummary | null;
}

export const useAuditStore = create<AuditState>((set, get) => ({
    currentLog: null,

    startNewLog: (filename, fileSize, totalRows, totalColumns, fileHash) => {
        const id = generateId();
        const newLog: AuditLog = {
            id,
            createdAt: Date.now(),
            filename,
            fileSize,
            fileHash,
            totalRows,
            totalColumns,
            entries: [],
            status: 'pending',
        };
        set({ currentLog: newLog });
        return id;
    },
    addEntry: (entry) => set((state) => {
        if (!state.currentLog) return state;

        const newEntry: AuditLogEntry = {
            ...entry,
            id: generateId(),
            timestamp: Date.now(),
        };

        return {
            currentLog: {
                ...state.currentLog,
                status: 'processing',
                entries: [...state.currentLog.entries, newEntry],
            },
        };
    }),

    setAnonymity: (anonymity) => set((state) =>
        state.currentLog ? { currentLog: { ...state.currentLog, anonymity } } : state
    ),

    completeLog: () => set((state) => {
        if (!state.currentLog) return state;

        const completedLog: AuditLog = {
            ...state.currentLog,
            status: 'completed',
            completedAt: Date.now(),
        };

        return {
            currentLog: completedLog,
        };
    }),

    failLog: (errorMessage) => set((state) => {
        if (!state.currentLog) return state;

        const failedLog: AuditLog = {
            ...state.currentLog,
            status: 'failed',
            completedAt: Date.now(),
            errorMessage,
        };

        return {
            currentLog: failedLog,
        };
    }),

    clearCurrentLog: () => set({ currentLog: null }),

    getLog: () => get().currentLog,

    getSummary: () => {
        const { currentLog } = get();
        if (!currentLog) return null;
        return generateAuditSummary(currentLog);
    },
}));
