import { session_ephemeral } from './wasm';
import type { ColumnPolicy } from '../types/policy';

export interface RunKeys {
    keys: Map<number, Uint8Array>;
    release: () => void;
}

export const deriveRunKeys = (
    indices: number[],
    policies: Record<number, ColumnPolicy>,
    headers: string[]
): RunKeys => {
    const keys = new Map<number, Uint8Array>();
    const wanted = indices.filter((i) => policies[i].keying === 'run');
    if (wanted.length === 0) return { keys, release: () => {} };

    const bad = wanted.find((i) => policies[i].type !== 'hash');
    if (bad !== undefined) {
        throw new Error(`policy "${policies[bad].type}" has no per-run keyed variant (hash only)`);
    }

    let session: ReturnType<typeof session_ephemeral> | null = session_ephemeral();
    try {
        for (const idx of wanted) keys.set(idx, session!.column_key(headers[idx] ?? String(idx)));
    } catch (err) {
        session!.free();
        throw err;
    }
    return {
        keys,
        release: () => {
            session?.free();
            session = null;
            keys.forEach((k) => k.fill(0));
            keys.clear();
        },
    };
};
