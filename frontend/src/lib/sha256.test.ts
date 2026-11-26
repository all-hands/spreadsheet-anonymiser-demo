// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const subtle = async (bytes: Uint8Array): Promise<string> =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

const bytesOf = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);

const incremental = (data: Uint8Array, sizes: number[]): string => {
    const h = sha256.create();
    let pos = 0;
    for (let i = 0; pos < data.length; i++) {
        const size = sizes[i % sizes.length];
        h.update(data.subarray(pos, pos + size));
        pos += size;
    }
    return bytesToHex(h.digest());
};

describe('incremental SHA-256 (@noble/hashes)', () => {
    it('matches crypto.subtle for lengths around the block/padding boundaries', async () => {
        for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 100_003]) {
            const data = bytesOf(n);
            expect(bytesToHex(sha256.create().update(data).digest())).toBe(await subtle(data));
        }
    });

    it('is independent of how the input is sliced', async () => {
        const data = bytesOf(10_000);
        const want = await subtle(data);
        for (const size of [1, 7, 63, 64, 65, 999, 4096]) {
            expect(incremental(data, [size])).toBe(want);
        }
    });

    it('hashes the empty input to the known constant', () => {
        expect(bytesToHex(sha256.create().digest())).toBe(
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        );
    });

    it('hashes "abc" to the FIPS 180-4 known answer', () => {
        const h = sha256.create().update(new TextEncoder().encode('abc'));
        expect(bytesToHex(h.digest())).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
        );
    });

    it('matches crypto.subtle on random inputs with random chunk splits', async () => {
        let seed = 0x2f6e2b1;
        const rand = (): number => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 2 ** 32;
        };
        for (let round = 0; round < 60; round++) {
            const data = Uint8Array.from({ length: Math.floor(rand() * 5000) }, () => Math.floor(rand() * 256));
            const sizes = Array.from({ length: 1 + Math.floor(rand() * 6) }, () => 1 + Math.floor(rand() * 300));
            expect(incremental(data, sizes), `round ${round}`).toBe(await subtle(data));
        }
    });
});
