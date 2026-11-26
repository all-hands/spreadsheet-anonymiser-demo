import { useState } from 'react';
import { createWorker } from '../lib/worker-client';
import { useAdvancedSessionStore } from '../store/advancedSessionStore';

export type KeyStatus = 'off' | 'deriving' | 'active';

export interface KeyedSession {
    passphrase: string;
    setPassphrase: (p: string) => void;
    salt: Uint8Array | null;
    keyStatus: KeyStatus;
    enable: () => Promise<void>;
    disable: () => Promise<void>;
    reset: () => Promise<void>;
}

export const useKeyedSession = (onStatus: (msg: string) => void): KeyedSession => {
    const [passphrase, setPassphrase] = useState('');
    const keyStatus = useAdvancedSessionStore((s) => s.keyStatus);
    const salt = useAdvancedSessionStore((s) => s.salt);
    const beginKeyChange = useAdvancedSessionStore.getState().beginKeyChange;
    const isStale = (epoch: number) => useAdvancedSessionStore.getState().keyEpoch !== epoch;

    const enable = async () => {
        if (!passphrase) return;
        const worker = createWorker();
        const epoch = beginKeyChange('deriving');
        try {
            const s = await worker.startSession(
                passphrase,
                (msg: string) => onStatus(msg)
            );
            if (isStale(epoch)) {
                try {
                    await worker.endSession();
                } catch {
                    // Nothing more to end.
                }
                return;
            }
            useAdvancedSessionStore.getState().setKey(s, 'active');
            setPassphrase('');
        } catch (err: unknown) {
            if (isStale(epoch)) return;
            const message = err instanceof Error ? err.message : 'Unknown error';
            onStatus(`Key error: ${message}`);
            beginKeyChange('off');
        }
    };

    const disable = async () => {
        beginKeyChange('off');
        const worker = createWorker();
        await worker.endSession();
        onStatus('Keyed session cleared. Hash falls back to unkeyed SHA-256.');
    };

    const reset = async () => {
        setPassphrase('');
        beginKeyChange('off');
        try {
            await createWorker().endSession();
        } catch {
            // Nothing to end if the worker never started.
        }
    };

    return { passphrase, setPassphrase, salt, keyStatus, enable, disable, reset };
};
