import { create } from 'zustand';

export const EXPLAIN_STORAGE_KEY = 'anonymiser.explanations';

const readStored = (): boolean => {
    try {
        return localStorage.getItem(EXPLAIN_STORAGE_KEY) !== 'off';
    } catch {
        return true;
    }
};

interface ExplainState {
    enabled: boolean;
    setEnabled: (on: boolean) => void;
}

export const useExplainStore = create<ExplainState>((set) => ({
    enabled: readStored(),
    setEnabled: (on) => {
        try {
            localStorage.setItem(EXPLAIN_STORAGE_KEY, on ? 'on' : 'off');
        } catch {
            /* storage unavailable: keep the in-memory setting */
        }
        set({ enabled: on });
    },
}));
