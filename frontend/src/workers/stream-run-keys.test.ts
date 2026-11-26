// @vitest-environment node
import { createHmac, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeSession {
    column_key: (name: string) => Uint8Array;
    free: () => void;
}
const sessions: Array<FakeSession & { free: ReturnType<typeof vi.fn> }> = [];

vi.mock('./wasm', async () => ({
    ...(await import('../lib/table/test-wasm')).realTableCodec(),
    ensureWasm: vi.fn(async () => {}),
    session_ephemeral: vi.fn(() => {
        const secret = randomBytes(64);
        const s = {
            column_key: (name: string) => new Uint8Array(createHmac('sha512', secret).update(name).digest()),
            free: vi.fn(() => secret.fill(0)),
        };
        sessions.push(s);
        return s;
    }),
    policy_key_material: vi.fn((await import('../lib/table/test-wasm')).realKeyMaterial()),
    apply_policy: vi.fn((v: string, p: string) => `${p}(${v})`),
    apply_policy_keyed_typed: vi.fn((v: string, _p: string, key: Uint8Array) =>
        createHmac('sha256', key).update(v).digest('hex').slice(0, 16)
    ),
    apply_policy_generalised: vi.fn(
        (v: string, p: string, width?: number, ref?: string) => `gen:${p}:${width ?? '-'}:${ref ?? '-'}:${v}`
    ),
    apply_policy_legacy: vi.fn(),
    reencode_token_str: vi.fn((t: string) => t),
    is_encrypted_value: vi.fn(() => false),
    decrypt_any_value: vi.fn(),
}));

import * as wasm from './wasm';
import { endSession } from './session';
import { cancelStream, streamAnonymize } from './stream';
import { STREAM_CHUNK_ROWS } from '../lib/constants';
import type { ColumnPolicy } from '../types/policy';

const ROWS = STREAM_CHUNK_ROWS * 3 + 17;
const csv = (): File => {
    const lines = ['id,dob,score'];
    for (let i = 0; i < ROWS; i++) lines.push(`user${i % 40},1990-05-0${(i % 9) + 1},${i % 100}`);
    return new File([lines.join('\n') + '\n'], 'people.csv');
};
const outputRows = async (blob: Blob | null | undefined): Promise<string[][]> =>
    (await blob!.text())
        .trimEnd()
        .split('\n')
        .slice(1)
        .map((l) => l.split(','));

beforeEach(() => {
    endSession();
    sessions.length = 0;
    vi.clearAllMocks();
});

describe('streamAnonymize: per-run keys', () => {
    const policies: Record<number, ColumnPolicy> = { 0: { type: 'hash', keying: 'run' } };

    it('derives ONE run secret for all batches: identical values give identical tokens', async () => {
        const spy = vi.fn();
        const res = await streamAnonymize(csv(), policies, {}, null, () => {}, spy);
        expect(spy.mock.calls.length).toBe(4);
        expect(vi.mocked(wasm.session_ephemeral)).toHaveBeenCalledTimes(1);

        const rows = await outputRows(res.blob);
        expect(rows).toHaveLength(ROWS);
        const tokensOf = new Map<string, Set<string>>();
        rows.forEach((r, i) => {
            const set = tokensOf.get(`user${i % 40}`) ?? new Set<string>();
            set.add(r[0]);
            tokensOf.set(`user${i % 40}`, set);
        });
        expect(tokensOf.size).toBe(40);
        for (const set of tokensOf.values()) expect(set.size).toBe(1);
        expect(new Set(rows.map((r) => r[0])).size).toBe(40);
    });

    it('a different run gets different tokens; each run frees its secret once', async () => {
        const a = await outputRows((await streamAnonymize(csv(), policies)).blob);
        const b = await outputRows((await streamAnonymize(csv(), policies)).blob);
        expect(vi.mocked(wasm.session_ephemeral)).toHaveBeenCalledTimes(2);
        expect(a[0][0]).not.toBe(b[0][0]);
        expect(sessions.map((s) => s.free.mock.calls.length)).toEqual([1, 1]);
    });

    it('frees the secret when the run is cancelled mid-stream', async () => {
        const spy = vi.fn(() => cancelStream());
        await expect(streamAnonymize(csv(), policies, {}, null, () => {}, spy)).rejects.toThrow();
        expect(sessions).toHaveLength(1);
        expect(sessions[0].free).toHaveBeenCalledTimes(1);
    });

    it('frees the secret when a batch throws', async () => {
        vi.mocked(wasm.apply_policy_keyed_typed).mockImplementationOnce(() => {
            throw new Error('boom');
        });
        await expect(streamAnonymize(csv(), policies)).rejects.toThrow('boom');
        expect(sessions[0].free).toHaveBeenCalledTimes(1);
    });
});

describe('streamAnonymize: generalisation parameters', () => {
    it('passes age-band reference date + width and bucket width to every batch', async () => {
        const res = await streamAnonymize(csv(), {
            1: { type: 'age-band', width: 5, referenceDate: '2026-01-01' },
            2: { type: 'bucket', width: 25 },
        });
        const rows = await outputRows(res.blob);
        expect(rows).toHaveLength(ROWS);
        expect(rows[0][1]).toBe('gen:age-band:5:2026-01-01:1990-05-01');
        expect(rows[ROWS - 1][1]).toMatch(/^gen:age-band:5:2026-01-01:/);
        expect(rows[ROWS - 1][2]).toMatch(/^gen:bucket:25:-:/);
        expect(res.counts).toEqual({ 1: ROWS, 2: ROWS });
        const calls = vi.mocked(wasm.apply_policy_generalised).mock.calls;
        expect(calls.every((c) => (c[1] === 'age-band' ? c[2] === 5 && c[3] === '2026-01-01' : c[2] === 25))).toBe(true);
        expect(vi.mocked(wasm.session_ephemeral)).not.toHaveBeenCalled();
    });
});
