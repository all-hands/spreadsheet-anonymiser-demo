// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./wasm', async () => ({
    ensureWasm: vi.fn(async () => {}),
    generate_salt: vi.fn(() => new Uint8Array(32)),
    session_from_passphrase: vi.fn(),
    policy_key_material: vi.fn((await import('../lib/table/test-wasm')).realKeyMaterial()),
    apply_policy: vi.fn((value: string, policy: string) => `unkeyed:${policy}:${value}`),
    apply_policy_keyed_typed: vi.fn(),
    apply_policy_legacy: vi.fn(),
    apply_policy_generalised: vi.fn(
        (value: string, policy: string, width?: number, ref?: string) =>
            `gen:${policy}:${width ?? '-'}:${ref ?? '-'}:${value}`
    ),
    reencode_token_str: vi.fn(),
    is_encrypted_value: vi.fn(() => false),
    decrypt_any_value: vi.fn(),
}));

import * as wasm from './wasm';
import { anonymizeData } from './anonymize';
import { endSession } from './session';
import type { ColumnPolicy } from '../types/policy';

const run = (data: string[][], policies: Record<number, ColumnPolicy>) =>
    anonymizeData(data, ['dob', 'score', 'joined', 'note'], [], policies, () => {});

beforeEach(() => {
    endSession();
    vi.clearAllMocks();
});

describe('anonymizeData — generalisation policies', () => {
    it('routes year / age-band / bucket through apply_policy_generalised with their parameters', async () => {
        const res = await run([['1990-05-05', '27', '2021-06-30', 'x']], {
            0: { type: 'age-band', width: 5, referenceDate: '2026-01-01' },
            1: { type: 'bucket' },
            2: { type: 'year' },
        });

        expect(res.data[0]).toEqual([
            'gen:age-band:5:2026-01-01:1990-05-05',
            'gen:bucket:-:-:27',
            'gen:year:-:-:2021-06-30',
            'x',
        ]);
        expect(vi.mocked(wasm.apply_policy)).not.toHaveBeenCalled();
    });

    it('counts non-empty cells only; blank cells never reach the core', async () => {
        const res = await run(
            [
                ['1990-05-05', '', '2021-06-30', 'x'],
                ['', '5', '', 'y'],
            ],
            {
                0: { type: 'year' },
                1: { type: 'bucket', width: 3 },
                2: { type: 'year' },
            }
        );
        expect(res.counts).toEqual({ 0: 1, 1: 1, 2: 1 });
        expect(vi.mocked(wasm.apply_policy_generalised)).toHaveBeenCalledTimes(3);
        expect(res.data[0][1]).toBe('');
        expect(res.data[1][0]).toBe('');
    });

    it('passes an empty reference date as undefined — core, not the worker, rejects it', async () => {
        await run([['1990-05-05', '', '', '']], { 0: { type: 'age-band', referenceDate: '' } });
        expect(vi.mocked(wasm.apply_policy_generalised)).toHaveBeenCalledWith(
            '1990-05-05',
            'age-band',
            undefined,
            undefined
        );
    });

    it('propagates the core error (no clock fallback) and aborts the run', async () => {
        vi.mocked(wasm.apply_policy_generalised).mockImplementationOnce(() => {
            throw new Error('age-band needs a reference date');
        });
        await expect(
            run([['1990-05-05', '', '', '']], { 0: { type: 'age-band' } })
        ).rejects.toThrow(/reference date/);
    });
});
