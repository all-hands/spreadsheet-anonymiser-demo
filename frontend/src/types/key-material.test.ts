// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { KEY_MATERIAL_STRINGS, toKeyMaterial } from './policy';
import { realWasm } from '../lib/table/test-wasm';

describe('KEY_MATERIAL_STRINGS', () => {
    it('equals the wasm key_material_vocabulary(), in order', () => {
        expect([...KEY_MATERIAL_STRINGS]).toEqual(realWasm().key_material_vocabulary());
    });

    it('covers what policy_key_material returns for every policy', () => {
        const w = realWasm();
        for (const p of w.policy_vocabulary()) {
            expect(KEY_MATERIAL_STRINGS).toContain(w.policy_key_material(p));
        }
    });

    it('toKeyMaterial narrows known values and throws on an unknown one', () => {
        for (const m of KEY_MATERIAL_STRINGS) expect(toKeyMaterial(m)).toBe(m);
        expect(() => toKeyMaterial('hsm')).toThrow(/unknown key material/);
    });
});
