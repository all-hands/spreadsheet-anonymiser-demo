import { describe, expect, it } from 'vitest';
import {
    CANON_EXPLANATIONS,
    HASH_CHOICE_EXPLANATIONS,
    MAX_EXPLANATION_LENGTH,
    POLICY_EXPLANATIONS,
    ROLE_EXPLANATIONS,
    SUPPRESS_EXPLANATIONS,
    TOKEN_ENCODING_EXPLANATIONS,
    allExplanationKeys,
    explanationFor,
} from './explanations';
import { CANON_TYPE_STRINGS, POLICY_STRINGS, TOKEN_ENCODING_STRINGS } from '../types/policy';
import { SUPPRESS_MODES } from '../types/anonymity';
import { COLUMN_ROLES } from './roles';

describe('explanations', () => {
    it('explains every policy in the vocabulary, deprecated and legacy ones included', () => {
        for (const p of POLICY_STRINGS) {
            expect(POLICY_EXPLANATIONS[p], `policy ${p}`).toBeTruthy();
            expect(explanationFor(`policy:${p}`)).toBe(POLICY_EXPLANATIONS[p]);
        }
        expect(Object.keys(POLICY_EXPLANATIONS).sort()).toEqual([...POLICY_STRINGS].sort());
    });

    it('explains every role, canon type, token encoding and suppression mode', () => {
        expect(Object.keys(ROLE_EXPLANATIONS).sort()).toEqual([...COLUMN_ROLES].sort());
        expect(Object.keys(CANON_EXPLANATIONS).sort()).toEqual([...CANON_TYPE_STRINGS].sort());
        expect(Object.keys(TOKEN_ENCODING_EXPLANATIONS).sort()).toEqual([...TOKEN_ENCODING_STRINGS].sort());
        expect(Object.keys(SUPPRESS_EXPLANATIONS).sort()).toEqual([...SUPPRESS_MODES].sort());
        expect(Object.keys(HASH_CHOICE_EXPLANATIONS)).toEqual(['hash-run', 'hash-unkeyed']);
    });

    it('has a non-empty text of at most the length cap for every key', () => {
        for (const key of allExplanationKeys()) {
            const text = explanationFor(key);
            expect(text, key).toBeTruthy();
            expect(text!.trim(), key).toBe(text);
            expect(text!.length, `${key}: ${text!.length} chars`).toBeLessThanOrEqual(MAX_EXPLANATION_LENGTH);
        }
    });

    it('has no duplicate texts (similar items share a key instead)', () => {
        const seen = new Map<string, string>();
        for (const key of allExplanationKeys()) {
            const text = explanationFor(key)!;
            expect(seen.get(text), `${key} repeats ${seen.get(text)}`).toBeUndefined();
            seen.set(text, key);
        }
    });

    it('never calls the output anonymous or uses "This button" filler', () => {
        for (const key of allExplanationKeys()) {
            const text = explanationFor(key)!;
            expect(text, key).not.toMatch(/^This (button|control|field)/i);
            expect(text, key).not.toMatch(/\bis anonymous\b|\bare anonymous\b|\bfully anonymous\b/i);
        }
    });

    it('returns undefined for an unknown key', () => {
        expect(explanationFor('policy:nope' as never)).toBeUndefined();
    });
});
