// @vitest-environment node
import { createHmac, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeSession {
    column_key: (name: string) => Uint8Array;
    free: () => void;
}
const sessions: FakeSession[] = [];
const seenKeys: Buffer[] = [];

vi.mock('./wasm', async () => ({
    ensureWasm: vi.fn(async () => {}),
    generate_salt: vi.fn(() => new Uint8Array(32)),
    session_from_passphrase: vi.fn(() => ({
        column_key: (name: string) => new TextEncoder().encode(`advanced:${name}`),
        column_key_scoped: (d: string, name: string) => new TextEncoder().encode(`advanced:${d}/${name}`),
    })),
    session_ephemeral: vi.fn(() => {
        const secret = randomBytes(64);
        const s: FakeSession = {
            column_key: (name) => new Uint8Array(createHmac('sha512', secret).update(name).digest()),
            free: vi.fn(() => secret.fill(0)),
        };
        sessions.push(s);
        return s;
    }),
    policy_key_material: vi.fn((await import('../lib/table/test-wasm')).realKeyMaterial()),
    apply_policy: vi.fn((v: string, p: string) => `unkeyed:${p}:${v}`),
    apply_policy_keyed_typed: vi.fn((v: string, _p: string, key: Uint8Array) => {
        seenKeys.push(Buffer.from(key));
        return createHmac('sha256', key).update(v).digest('hex').slice(0, 32);
    }),
    apply_policy_legacy: vi.fn(),
    reencode_token_str: vi.fn((t: string) => t),
    is_encrypted_value: vi.fn(() => false),
    decrypt_any_value: vi.fn(),
}));

import * as wasm from './wasm';
import { anonymizeData } from './anonymize';
import { endSession, startSession } from './session';
import type { ColumnPolicy } from '../types/policy';

const RUN: ColumnPolicy = { type: 'hash', keying: 'run' };
const rows = () => [['alice@x.com'], ['bob@x.com'], ['alice@x.com'], ['']];
const run = (policies: Record<number, ColumnPolicy> = { 0: RUN }, data: unknown[][] = rows(), progress: (m: string) => void = () => {}) =>
    anonymizeData(data as never, ['email'], [], policies, progress);
const column = (res: { data: unknown[][] }, i = 0) => res.data.map((r) => r[i]);

beforeEach(() => {
    endSession();
    sessions.length = 0;
    seenKeys.length = 0;
    vi.clearAllMocks();
});

describe('per-run keyed hash', () => {
    it('gives different tokens for the same input on two runs (not joinable)', async () => {
        const a = column(await run());
        const b = column(await run());
        expect(a[0]).toMatch(/^[0-9a-f]{32}$/);
        expect(b[0]).toMatch(/^[0-9a-f]{32}$/);
        expect(a[0]).not.toBe(b[0]);
        expect(a[1]).not.toBe(b[1]);
        expect(vi.mocked(wasm.session_ephemeral)).toHaveBeenCalledTimes(2);
    });

    it('is consistent within a run: same value -> same token, distinct values differ, empty stays empty', async () => {
        const out = column(await run());
        expect(out[0]).toBe(out[2]);
        expect(out[0]).not.toBe(out[1]);
        expect(out[3]).toBe('');
    });

    it('uses one ephemeral session per run, however many columns', async () => {
        const res = await anonymizeData(
            [['a', 'b']] as never,
            ['c0', 'c1'],
            [],
            { 0: RUN, 1: RUN },
            () => {}
        );
        expect(vi.mocked(wasm.session_ephemeral)).toHaveBeenCalledTimes(1);
        const same = await anonymizeData([['v', 'v']] as never, ['c0', 'c1'], [], { 0: RUN, 1: RUN }, () => {});
        expect(same.data[0][0]).not.toBe(same.data[0][1]);
        expect(res.counts).toEqual({ 0: 1, 1: 1 });
    });

    it('never leaks the secret or column key into output or progress messages', async () => {
        const messages: string[] = [];
        const res = await run({ 0: RUN }, rows(), (m: string) => void messages.push(m));
        const blob = JSON.stringify(res) + messages.join('\n');
        expect(seenKeys.length).toBeGreaterThan(0);
        expect(seenKeys[0].some((b) => b !== 0)).toBe(true);
        for (const k of seenKeys) {
            expect(blob).not.toContain(k.toString('hex'));
            expect(blob).not.toContain(k.toString('base64'));
        }
        expect(blob).not.toMatch(/secret|passphrase/i);
    });

    it('drops the secret after the run: session freed, JS key copies zero-filled', async () => {
        await run();
        expect(sessions).toHaveLength(1);
        expect(sessions[0].free).toHaveBeenCalledTimes(1);
        const keys = vi.mocked(wasm.apply_policy_keyed_typed).mock.calls.map((c) => c[2] as Uint8Array);
        expect(keys.length).toBeGreaterThan(0);
        for (const k of keys) expect([...k].every((b) => b === 0)).toBe(true);
    });

    it('drops the secret when the run throws', async () => {
        vi.mocked(wasm.apply_policy_keyed_typed).mockImplementationOnce(() => {
            throw new Error('boom');
        });
        await expect(run()).rejects.toThrow('boom');
        expect(sessions[0].free).toHaveBeenCalledTimes(1);
    });

    it('is independent of an Advanced passphrase session and leaves it untouched', async () => {
        await startSession('pw', () => {});
        const seen: string[] = [];
        const real = vi.mocked(wasm.apply_policy_keyed_typed).getMockImplementation();
        vi.mocked(wasm.apply_policy_keyed_typed).mockImplementation((...a) => {
            seen.push(new TextDecoder().decode(a[2] as Uint8Array));
            return real!(...a);
        });
        const res = await anonymizeData(
            [['x', 'x']] as never,
            ['a', 'b'],
            [],
            { 0: RUN, 1: { type: 'hash' } },
            () => {}
        );
        const calls = vi.mocked(wasm.apply_policy_keyed_typed).mock.calls;
        expect(seen[1]).toBe('advanced:b');
        expect((calls[0][2] as Uint8Array).length).toBe(64);
        expect(res.data[0][0]).not.toBe(res.data[0][1]);
        await expect(
            anonymizeData([['y']] as never, ['b'], [], { 0: { type: 'hash' } }, () => {})
        ).resolves.toBeTruthy();
    });

    it('creates no session when no column asks for it', async () => {
        await anonymizeData([['x']] as never, ['a'], [], { 0: { type: 'hash' } }, () => {});
        expect(vi.mocked(wasm.session_ephemeral)).not.toHaveBeenCalled();
    });

    it('rejects keying on a policy that has no per-run keyed variant, before any session exists', async () => {
        await expect(
            anonymizeData([['x']] as never, ['a'], [], { 0: { type: 'mask', keying: 'run' } }, () => {})
        ).rejects.toThrow(/no per-run keyed variant/);
        expect(vi.mocked(wasm.session_ephemeral)).not.toHaveBeenCalled();
    });
});
