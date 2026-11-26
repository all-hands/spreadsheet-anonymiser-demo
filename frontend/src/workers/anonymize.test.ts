// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./wasm', async () => {
    return {
        ensureWasm: vi.fn(async () => {}),
        generate_salt: vi.fn(() => new Uint8Array(32)),
        session_from_passphrase: vi.fn(() => ({
            column_key: (name: string) => new TextEncoder().encode(`colkey:${name}`),
            column_key_scoped: (dataset: string, name: string) =>
                new TextEncoder().encode(`colkey:${dataset}/${name}`),
        })),
        policy_key_material: vi.fn((await import('../lib/table/test-wasm')).realKeyMaterial()),
        apply_policy: vi.fn((value: string, policy: string) => `unkeyed:${policy}:${value}`),
        apply_policy_keyed_typed: vi.fn(
            (value: string, policy: string) => `keyed:${policy}:${value}`
        ),
        apply_policy_legacy: vi.fn((value: string, policy: string) => `legacy:${policy}:${value}`),
        reencode_token_str: vi.fn((token: string) => `b32:${token}`),
        is_encrypted_value: vi.fn((value: string) =>
            value.startsWith('enc:') || value.startsWith('kyber:') || value.startsWith('qenc:')
        ),
        decrypt_any_value: vi.fn((value: string) => `any:${value}`),
    };
});

import * as wasm from './wasm';
import { anonymizeData, decryptData } from './anonymize';
import { endSession, startSession } from './session';
import type { ColumnPolicy, PolicyType } from '../types/policy';

const noProgress = () => {};
const policyOf = (type: PolicyType): ColumnPolicy => ({ type });

beforeEach(() => {
    endSession();
    vi.clearAllMocks();
});

describe('anonymizeData', () => {
    it('counts only non-empty transformed cells; empty cells pass through', async () => {
        const data = [
            ['Ann', '', 'x'],
            ['', 'b@x.com', 'y'],
            ['Cy', 'c@x.com', ''],
        ];
        const policies = { 0: policyOf('faux'), 1: policyOf('hash') };

        const res = await anonymizeData(data, ['name', 'email', 'misc'], [], policies, noProgress);

        expect(res.counts).toEqual({ 0: 2, 1: 2 });
        expect(res.data[0][0]).toBe('unkeyed:faux:Ann');
        expect(res.data[1][0]).toBe('');
        expect(res.data[2][0]).toBe('unkeyed:faux:Cy');
        expect(res.data[0][1]).toBe('');
        expect(res.data[1][1]).toBe('unkeyed:hash:b@x.com');
        expect(res.data[2][2]).toBe('');
        expect(vi.mocked(wasm.apply_policy_keyed_typed)).not.toHaveBeenCalled();
    });

    it('rejects legacy passphrase-keyed policies before touching any cell', async () => {
        const policies = { 0: policyOf('legacy-hmac-sha256'), 1: policyOf('redact') };
        await expect(
            anonymizeData([['a', 'b']], ['name', 'note'], [], policies, noProgress)
        ).rejects.toThrow(/keys on the passphrase.*start a keyed session first/s);
        expect(vi.mocked(wasm.apply_policy_legacy)).not.toHaveBeenCalled();
        expect(vi.mocked(wasm.apply_policy)).not.toHaveBeenCalled();
    });

    it('runs legacy policies against the passphrase bytes once a session exists', async () => {
        const salt = await startSession('pw', noProgress);
        expect(salt).toBeInstanceOf(Uint8Array);

        const res = await anonymizeData(
            [['secret']],
            ['name'],
            [],
            { 0: policyOf('legacy-aes') },
            noProgress
        );

        expect(res.data[0][0]).toBe('legacy:legacy-aes:secret');
        expect(vi.mocked(wasm.apply_policy_legacy)).toHaveBeenCalledWith(
            'secret',
            'legacy-aes',
            new TextEncoder().encode('pw')
        );
    });

    it('base32 re-encodes only keyed hash columns, skipping empty cells', async () => {
        await startSession('pw', noProgress);
        const policies = { 0: policyOf('hash'), 1: policyOf('encrypt') };

        const res = await anonymizeData(
            [
                ['a', 'b'],
                ['', 'd'],
            ],
            ['h0', 'h1'],
            [],
            policies,
            noProgress,
            { tokenEncoding: 'base32' }
        );

        expect(vi.mocked(wasm.reencode_token_str).mock.calls).toEqual([
            ['keyed:hash:a', 'hash', 'base32'],
        ]);
        expect(res.data[0][0]).toBe('b32:keyed:hash:a');
        expect(res.data[1][0]).toBe('');
        expect(res.data[0][1]).toBe('keyed:encrypt:b');
        expect(vi.mocked(wasm.apply_policy_keyed_typed)).toHaveBeenCalledWith(
            'a',
            'hash',
            expect.any(Uint8Array),
            16,
            'auto'
        );
    });

    it('base32 leaves the unkeyed hash fallback untouched', async () => {
        const res = await anonymizeData(
            [['a']],
            ['h0'],
            [],
            { 0: policyOf('hash') },
            noProgress,
            { tokenEncoding: 'base32' }
        );

        expect(vi.mocked(wasm.reencode_token_str)).not.toHaveBeenCalled();
        expect(res.data[0][0]).toBe('unkeyed:hash:a');
    });
});

describe('decryptData', () => {
    it('derives unscoped column keys without a dataset (v1 behaviour)', async () => {
        await startSession('pw', noProgress);

        const res = await decryptData([['enc:v1:a']], ['email'], noProgress);

        expect(res.decrypted).toBe(1);
        expect(res.data[0][0]).toBe('any:enc:v1:a');
        expect(vi.mocked(wasm.decrypt_any_value)).toHaveBeenCalledWith(
            'enc:v1:a',
            new TextEncoder().encode('colkey:email'),
            new TextEncoder().encode('pw')
        );
    });

    it('derives dataset-scoped keys when opts.dataset is set — the same keys the encrypting run used', async () => {
        await startSession('pw', noProgress);

        const res = await decryptData([['enc:v1:a']], ['email'], noProgress, { dataset: 'ds' });

        expect(res.decrypted).toBe(1);
        expect(vi.mocked(wasm.decrypt_any_value)).toHaveBeenCalledWith(
            'enc:v1:a',
            new TextEncoder().encode('colkey:ds/email'),
            new TextEncoder().encode('pw')
        );
    });

    it('routes kyber: cells through the same core-owned entry (no JS prefix branch)', async () => {
        await startSession('pw', noProgress);

        const res = await decryptData([['kyber:v1:x']], ['email'], noProgress);

        expect(res.decrypted).toBe(1);
        expect(res.data[0][0]).toBe('any:kyber:v1:x');
        expect(vi.mocked(wasm.decrypt_any_value)).toHaveBeenCalledWith(
            'kyber:v1:x',
            new TextEncoder().encode('colkey:email'),
            new TextEncoder().encode('pw')
        );
    });

    it('passes both key materials for old-app enc:/qenc: cells; the core dispatches on the passphrase', async () => {
        await startSession('pw', noProgress);

        const res = await decryptData(
            [['enc:oldblob', 'qenc:quantumblob']],
            ['a', 'b'],
            noProgress
        );

        expect(res.decrypted).toBe(2);
        const pw = new TextEncoder().encode('pw');
        expect(vi.mocked(wasm.decrypt_any_value)).toHaveBeenCalledWith(
            'enc:oldblob',
            new TextEncoder().encode('colkey:a'),
            pw
        );
        expect(vi.mocked(wasm.decrypt_any_value)).toHaveBeenCalledWith(
            'qenc:quantumblob',
            new TextEncoder().encode('colkey:b'),
            pw
        );
        expect(res.data[0]).toEqual(['any:enc:oldblob', 'any:qenc:quantumblob']);
    });

    it('passes non-ciphertext cells through without deriving a decrypt call', async () => {
        await startSession('pw', noProgress);

        const res = await decryptData([['plain', '']], ['email'], noProgress);

        expect(res.decrypted).toBe(0);
        expect(res.data[0]).toEqual(['plain', '']);
        expect(vi.mocked(wasm.decrypt_any_value)).not.toHaveBeenCalled();
    });
});
