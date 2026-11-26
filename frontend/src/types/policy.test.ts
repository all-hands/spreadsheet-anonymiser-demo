import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    BASIC_POLICY_OPTIONS,
    BASIC_POLICY_TYPES,
    CANON_TYPE_STRINGS,
    DEFAULT_GENERALISE_WIDTH,
    DEPRECATED_POLICY_STRINGS,
    isDeprecatedPolicy,
    SELECTABLE_POLICY_OPTIONS,
    GENERALISATION_POLICIES,
    POLICY_OPTIONS,
    POLICY_STRINGS,
    TOKEN_ENCODING_STRINGS,
} from './policy';

const coreSrc = {
    policy: readFileSync(
        resolve(__dirname, '../../../crates/anonymiser-core/src/policy.rs'),
        'utf-8'
    ),
    canon: readFileSync(
        resolve(__dirname, '../../../crates/anonymiser-core/src/canon.rs'),
        'utf-8'
    ),
    token: readFileSync(
        resolve(__dirname, '../../../crates/anonymiser-core/src/token.rs'),
        'utf-8'
    ),
};

const rustVocabulary = (src: string, name: string) => {
    const m = new RegExp(`pub const ${name}: &\\[&str\\] = &\\[([^\\]]*)\\]`).exec(src);
    if (!m) throw new Error(`${name} not found in the Rust source`);
    return [...m[1].matchAll(/"([a-z0-9-]+)"/g)].map((e) => e[1]);
};

describe('policy vocabulary', () => {
    it('lists every policy the core accepts (and wasm forwards), in order', () => {
        expect(rustVocabulary(coreSrc.policy, 'POLICY_VOCABULARY')).toEqual([
            ...POLICY_STRINGS,
        ]);
    });

    it('gives every policy exactly one UI option', () => {
        expect(POLICY_OPTIONS.map((o) => o.type)).toEqual([...POLICY_STRINGS]);
    });
});

describe('deprecated policy vocabulary', () => {
    it('mirrors the core list, and every entry is still recognised', () => {
        const core = rustVocabulary(coreSrc.policy, 'DEPRECATED_POLICY_VOCABULARY');
        expect(core).toEqual([...DEPRECATED_POLICY_STRINGS]);
        expect(core).toEqual(['kyber-aes']);
        for (const p of DEPRECATED_POLICY_STRINGS) {
            expect(POLICY_STRINGS).toContain(p);
            expect(isDeprecatedPolicy(p)).toBe(true);
        }
        expect(isDeprecatedPolicy('encrypt')).toBe(false);
        expect(isDeprecatedPolicy('legacy-kyber-aes')).toBe(false);
    });

    it('is left out of every selector list', () => {
        const core = rustVocabulary(coreSrc.policy, 'POLICY_VOCABULARY');
        const deprecated = rustVocabulary(coreSrc.policy, 'DEPRECATED_POLICY_VOCABULARY');
        expect(SELECTABLE_POLICY_OPTIONS.map((o) => o.type)).toEqual(
            core.filter((p) => !deprecated.includes(p))
        );
        expect(BASIC_POLICY_TYPES).not.toContain('kyber-aes');
    });
});

describe('canonicalization vocabulary', () => {
    it('lists every canon type the core accepts (and wasm forwards), in order', () => {
        expect(rustVocabulary(coreSrc.canon, 'CANON_TYPE_VOCABULARY')).toEqual([
            ...CANON_TYPE_STRINGS,
        ]);
    });
});

describe('token encoding vocabulary', () => {
    it('lists every alphabet the core accepts (and wasm forwards), in order', () => {
        expect(rustVocabulary(coreSrc.token, 'TOKEN_ENCODING_VOCABULARY')).toEqual([
            ...TOKEN_ENCODING_STRINGS,
        ]);
    });
});

describe('basic policy subset', () => {
    it('is exactly the ten key-free policies, in option-table order', () => {
        expect(BASIC_POLICY_TYPES).toEqual([
            'keep',
            'redact',
            'mask',
            'mask-email',
            'mask-last4',
            'hash',
            'faux',
            'year',
            'age-band',
            'bucket',
        ]);
    });

    it('keeps every basic option in the standard group (legacy stays advanced-only)', () => {
        expect(BASIC_POLICY_OPTIONS).toHaveLength(10);
        for (const option of BASIC_POLICY_OPTIONS) {
            expect(option.group).toBe('standard');
            expect(option.type).not.toMatch(/^legacy-/);
        }
        expect(POLICY_OPTIONS.filter((o) => o.group === 'legacy').some((o) => o.basic)).toBe(false);
    });
});

describe('generalisation vocabulary', () => {
    it('lists year, age-band and bucket — all in the core vocabulary and in Simple mode', () => {
        expect(GENERALISATION_POLICIES).toEqual(['year', 'age-band', 'bucket']);
        const core = rustVocabulary(coreSrc.policy, 'POLICY_VOCABULARY');
        for (const g of GENERALISATION_POLICIES) {
            expect(core).toContain(g);
            expect(BASIC_POLICY_TYPES).toContain(g);
        }
    });

    it('mirrors the core default width', () => {
        const src = readFileSync(
            resolve(__dirname, '../../../crates/anonymiser-core/src/generalise/mod.rs'),
            'utf-8'
        );
        const m = /pub const DEFAULT_WIDTH: u32 = (\d+);/.exec(src);
        expect(Number(m?.[1])).toBe(DEFAULT_GENERALISE_WIDTH);
    });
});
