import { describe, it, expect } from 'vitest';
import { exportPolicyDoc, importPolicyDoc as importWithHeaders } from './policy-io';
import type { PolicyApplier } from './policy-io';
import type { CanonType, ColumnPolicy, PolicyType } from '../types/policy';
import { CANON_TYPE_STRINGS, DEPRECATED_POLICY_STRINGS, POLICY_STRINGS } from '../types/policy';

const WIDE = Array.from({ length: 50 }, (_, i) => `col${i}`);
const importPolicyDoc = (json: unknown, apply: PolicyApplier) => importWithHeaders(json, WIDE, apply);

const recorder = () => {
    const calls: Array<{ index: number; action: PolicyType; canon?: CanonType }> = [];
    const apply: PolicyApplier = (index, action, canon) => calls.push({ index, action, canon });
    return { calls, apply };
};

describe('policy-io', () => {
    describe('exportPolicyDoc', () => {
        it('never carries roles or anonymity settings (the CLI policy file is frozen)', () => {
            const doc = exportPolicyDoc(['a'], { 0: { type: 'redact' } });
            expect(Object.keys(doc).sort()).toEqual(['columns', 'version']);
            expect(Object.keys(doc.columns[0]).sort()).toEqual(['action', 'index', 'name']);
        });

        it('round-trips policies through export then import', () => {
            const headers = ['email', 'name', 'id'];
            const policies: Record<number, ColumnPolicy> = {
                0: { type: 'hash', canon: 'email' },
                1: { type: 'redact' },
            };

            const doc = exportPolicyDoc(headers, policies);
            expect(doc).toEqual({
                version: 1,
                columns: [
                    { name: 'email', index: 0, action: 'hash', type: 'email' },
                    { name: 'name', index: 1, action: 'redact' },
                    { name: 'id', index: 2, action: 'keep' },
                ],
            });

            const { calls, apply } = recorder();
            const applied = importPolicyDoc(JSON.parse(JSON.stringify(doc)), apply);
            expect(applied).toBe(3);
            expect(calls).toEqual([
                { index: 0, action: 'hash', canon: 'email' },
                { index: 1, action: 'redact', canon: undefined },
                { index: 2, action: 'keep', canon: undefined },
            ]);
        });

        it('omits canon type when a hash column has none', () => {
            const doc = exportPolicyDoc(['a'], { 0: { type: 'hash' } });
            expect(doc.columns[0]).not.toHaveProperty('type');
        });
    });

    describe('importPolicyDoc', () => {
        it('rejects unknown actions', () => {
            const { calls, apply } = recorder();
            expect(() =>
                importPolicyDoc({ columns: [{ name: 'a', index: 0, action: 'shred' }] }, apply)
            ).toThrow('unknown policy.json value(s): shred');
            expect(calls).toEqual([]);
        });

        it('rejects unknown canon types', () => {
            const { calls, apply } = recorder();
            expect(() =>
                importPolicyDoc(
                    { columns: [{ name: 'a', index: 0, action: 'hash', type: 'fingerprint' }] },
                    apply
                )
            ).toThrow('unknown policy.json value(s): type:fingerprint');
            expect(calls).toEqual([]);
        });

        it('reports kyber-aes as deprecated and applies the other columns', () => {
            const { calls, apply } = recorder();
            expect(() =>
                importPolicyDoc(
                    {
                        version: 1,
                        columns: [
                            { name: 'member_id', index: 0, action: 'kyber-aes' },
                            { name: 'choice1', index: 2, action: 'hash' },
                            { name: 'choice2', index: 3, action: 'encrypt' },
                            { name: 'old', index: 4, action: 'legacy-kyber-aes' },
                        ],
                    },
                    apply
                )
            ).toThrow(
                'unknown policy.json value(s): kyber-aes (deprecated, refused for new runs: use encrypt)'
            );
            expect(calls).toEqual([
                { index: 2, action: 'hash', canon: undefined },
                { index: 3, action: 'encrypt', canon: undefined },
                { index: 4, action: 'legacy-kyber-aes', canon: undefined },
            ]);
        });

        it('requires columns to be an array', () => {
            const { apply } = recorder();
            for (const bad of [{}, { columns: 'all' }, { columns: null }, null, 'policy']) {
                expect(() => importPolicyDoc(bad, apply)).toThrow(
                    'policy.json must contain a "columns" array'
                );
            }
        });

        it('skips entries missing action or index', () => {
            const { calls, apply } = recorder();
            const applied = importPolicyDoc(
                {
                    columns: [
                        { name: 'no-action', index: 0 },
                        { action: 'mask' },
                        { index: '0', action: 'mask' },
                        { name: 'bad-action', index: 1, action: 42 },
                        null,
                        { name: 'ok', index: 2, action: 'faux' },
                    ],
                },
                apply
            );
            expect(applied).toBe(1);
            expect(calls).toEqual([{ index: 2, action: 'faux', canon: undefined }]);
        });
    });
    describe('generalisation parameters', () => {
        it('exports width / reference_date only where the policy takes them', () => {
            const doc = exportPolicyDoc(['dob', 'score', 'joined', 'name'], {
                0: { type: 'age-band', width: 5, referenceDate: '2026-01-01' },
                1: { type: 'bucket', width: 20 },
                2: { type: 'year', width: 3, referenceDate: '2026-01-01' },
                3: { type: 'redact', width: 3 },
            });
            expect(doc.columns).toEqual([
                { name: 'dob', index: 0, action: 'age-band', width: 5, reference_date: '2026-01-01' },
                { name: 'score', index: 1, action: 'bucket', width: 20 },
                { name: 'joined', index: 2, action: 'year' },
                { name: 'name', index: 3, action: 'redact' },
            ]);
        });

        it('round-trips parameters through export then import', () => {
            const policies: Record<number, ColumnPolicy> = {
                0: { type: 'age-band', width: 5, referenceDate: '2026-01-01' },
                1: { type: 'bucket' },
            };
            const doc = JSON.parse(JSON.stringify(exportPolicyDoc(['dob', 'score'], policies)));
            const seen: unknown[] = [];
            importPolicyDoc(doc, (i, action, _canon, params) => seen.push([i, action, params]));
            expect(seen).toEqual([
                [0, 'age-band', { width: 5, referenceDate: '2026-01-01' }],
                [1, 'bucket', undefined],
            ]);
        });

        it('passes only the keys the document declared', () => {
            const seen: unknown[] = [];
            importPolicyDoc(
                { columns: [{ index: 0, action: 'age-band', width: 20 }] },
                (_i, _a, _c, params) => seen.push(params)
            );
            expect(seen).toEqual([{ width: 20 }]);
            expect(seen[0]).not.toHaveProperty('referenceDate');
        });

        it('rejects invalid widths and dates, applying the valid columns first', () => {
            const { calls, apply } = recorder();
            expect(() =>
                importPolicyDoc(
                    {
                        columns: [
                            { index: 0, action: 'bucket', width: 0 },
                            { index: 1, action: 'bucket', width: 2.5 },
                            { index: 2, action: 'age-band', reference_date: '01/01/2026' },
                            { index: 3, action: 'bucket', width: 5 },
                        ],
                    },
                    apply
                )
            ).toThrow('unknown policy.json value(s): width:0, width:2.5, reference_date:01/01/2026');
            expect(calls.map((c) => c.index)).toEqual([3]);
        });
    });

    describe('vocabulary-derived schema', () => {
        it('applies every recognised, non-deprecated action and every canon type', () => {
            const live = POLICY_STRINGS.filter(
                (p) => !(DEPRECATED_POLICY_STRINGS as readonly string[]).includes(p)
            );
            const { calls, apply } = recorder();
            expect(
                importPolicyDoc({ columns: live.map((action, index) => ({ index, action })) }, apply)
            ).toBe(live.length);
            expect(calls.map((c) => c.action)).toEqual(live);

            const typed = recorder();
            importPolicyDoc(
                { columns: CANON_TYPE_STRINGS.map((type, index) => ({ index, action: 'hash', type })) },
                typed.apply
            );
            expect(typed.calls.map((c) => c.canon)).toEqual([...CANON_TYPE_STRINGS]);
        });

        it('reports only the first bad field of an entry, in action, type, width, date order', () => {
            const { calls, apply } = recorder();
            expect(() =>
                importPolicyDoc(
                    {
                        columns: [
                            { index: 0, action: 'shred', type: 'nope', width: 0 },
                            { index: 1, action: 'hash', type: 'nope', width: 0 },
                            { index: 2, action: 'bucket', width: 0, reference_date: 'x' },
                        ],
                    },
                    apply
                )
            ).toThrow('unknown policy.json value(s): shred, type:nope, width:0');
            expect(calls).toEqual([]);
        });
    });

    describe('hostile input', () => {
        const REPORT = /^(unknown policy\.json value\(s\): |policy\.json must contain a "columns" array$)/;
        const outcome = (json: unknown) => {
            const { calls, apply } = recorder();
            try {
                return { applied: importPolicyDoc(json, apply), calls, error: undefined };
            } catch (e) {
                expect(e).toBeInstanceOf(Error);
                expect((e as Error).message).toMatch(REPORT);
                return { applied: undefined, calls, error: (e as Error).message };
            }
        };

        it('skips entries whose index or action has the wrong type', () => {
            const r = outcome({
                columns: [
                    { index: true, action: 'hash' },
                    { index: [0], action: 'hash' },
                    { index: { valueOf: 0 }, action: 'hash' },
                    { index: 0, action: ['hash'] },
                    { index: 0, action: { toString: 'hash' } },
                    { index: null, action: null },
                    'hash',
                    7,
                    [0, 'hash'],
                    { index: 5, action: 'redact' },
                ],
            });
            expect(r.error).toBeUndefined();
            expect(r.calls).toEqual([{ index: 5, action: 'redact', canon: undefined }]);
        });

        it('reports wrong-typed optional fields without throwing anything else', () => {
            const r = outcome({
                columns: [
                    { index: 0, action: 'hash', type: 42 },
                    { index: 1, action: 'hash', type: { deep: true } },
                    { index: 2, action: 'bucket', width: '5' },
                    { index: 3, action: 'age-band', reference_date: 20260101 },
                    { index: 4, action: 'hash', type: Object.create(null) },
                    { index: 5, action: 'keep' },
                ],
            });
            expect(r.error).toBe(
                'unknown policy.json value(s): type:42, type:[object Object], width:5, ' +
                    'reference_date:20260101, type:object'
            );
            expect(r.calls.map((c) => c.index)).toEqual([5]);
        });

        it('bounds huge strings in the report and never applies them', () => {
            const huge = 'x'.repeat(1_000_000);
            const r = outcome({
                columns: [
                    { index: 0, action: huge },
                    { index: 1, action: 'hash', type: huge },
                    { index: 2, action: 'keep', name: huge },
                ],
            });
            expect(r.error!.length).toBeLessThan(250);
            expect(r.error).toContain(`${'x'.repeat(64)}…`);
            expect(r.calls).toEqual([{ index: 2, action: 'keep', canon: undefined }]);
        });

        it('treats prototype keys as data, not as allowlist hits or pollution', () => {
            const parsed = JSON.parse(
                '{"__proto__":{"polluted":true},"columns":[' +
                    '{"index":0,"action":"__proto__"},' +
                    '{"index":1,"action":"constructor"},' +
                    '{"index":2,"action":"toString"},' +
                    '{"index":3,"action":"hash","type":"constructor"},' +
                    '{"index":4,"action":"hash","type":"__proto__"},' +
                    '{"__proto__":{"index":5,"action":"hash"}},' +
                    '{"index":6,"action":"faux","__proto__":{"type":"email"}}]}'
            );
            const r = outcome(parsed);
            expect(r.error).toBe(
                'unknown policy.json value(s): __proto__, constructor, toString, ' +
                    'type:constructor, type:__proto__'
            );
            expect(r.calls).toEqual([{ index: 6, action: 'faux', canon: undefined }]);
            expect(({} as Record<string, unknown>).polluted).toBeUndefined();
            expect(Object.prototype).not.toHaveProperty('polluted');
        });

        it('copes with deeply nested values', () => {
            let deep: unknown = 'leaf';
            for (let i = 0; i < 10_000; i++) deep = { deep };
            const r = outcome({
                columns: [
                    { index: 0, action: deep },
                    { index: 1, action: 'bucket', width: deep },
                    { index: 2, action: 'mask', extra: deep },
                ],
            });
            expect(r.error).toBe('unknown policy.json value(s): width:[object Object]');
            expect(r.calls).toEqual([{ index: 2, action: 'mask', canon: undefined }]);
            expect(outcome(deep).error).toBe('policy.json must contain a "columns" array');
            expect(outcome({ columns: deep }).error).toBe('policy.json must contain a "columns" array');
        });

        it('applies duplicate column names and indices in document order', () => {
            const r = outcome({
                columns: [
                    { name: 'email', index: 0, action: 'hash' },
                    { name: 'email', index: 0, action: 'redact' },
                    { name: 'email', index: 1, action: 'mask' },
                ],
            });
            expect(r.applied).toBe(3);
            expect(r.calls.map((c) => [c.index, c.action])).toEqual([
                [0, 'hash'],
                [0, 'redact'],
                [1, 'mask'],
            ]);
        });

        it('rejects non-document top levels with the columns message', () => {
            for (const bad of [undefined, 0, true, [], [{ index: 0, action: 'hash' }], { columns: {} }]) {
                expect(outcome(bad).error).toBe('policy.json must contain a "columns" array');
            }
        });
    });
    describe('fail-closed import', () => {
        it('refuses an unsupported or malformed version, naming it', () => {
            for (const version of [99, 2, -1, 1.5, '1', null, {}]) {
                const { calls, apply } = recorder();
                expect(() =>
                    importPolicyDoc({ version, columns: [{ index: 0, action: 'hash' }] }, apply)
                ).toThrow(/unsupported policy\.json version/);
                expect(calls).toEqual([]);
            }
            expect(() => importPolicyDoc({ version: 99, columns: [] }, recorder().apply)).toThrow(
                'unsupported policy.json version 99 (this app reads version 1)'
            );
        });

        it('accepts version 0 or an absent version, as the CLI does', () => {
            expect(importPolicyDoc({ version: 0, columns: [{ index: 0, action: 'hash' }] }, recorder().apply)).toBe(1);
            expect(importPolicyDoc({ columns: [{ index: 0, action: 'hash' }] }, recorder().apply)).toBe(1);
        });

        it('refuses a document that applies nothing instead of reporting zero columns', () => {
            expect(() => importPolicyDoc({ version: 1, columns: [] }, recorder().apply)).toThrow(/empty "columns"/);
            expect(() =>
                importPolicyDoc({ version: 1, columns: [{ name: 'x' }, null] }, recorder().apply)
            ).toThrow(/no usable columns/);
        });
    });

    describe('binding to the loaded columns', () => {
        const headers = ['a', 'B', 'c', 'd', 'e'];
        const run = (columns: unknown[]) => {
            const { calls, apply } = recorder();
            let error: string | undefined;
            let applied: number | undefined;
            try {
                applied = importWithHeaders({ columns }, headers, apply);
            } catch (e) {
                error = (e as Error).message;
            }
            for (const c of calls) expect(c.index).toBeGreaterThanOrEqual(0);
            for (const c of calls) expect(c.index).toBeLessThan(headers.length);
            return { calls, applied, error };
        };

        it('rejects an index past the last column and does not count it', () => {
            const r = run([
                { index: 0, action: 'redact' },
                { index: 9, action: 'redact' },
            ]);
            expect(r.calls).toEqual([{ index: 0, action: 'redact', canon: undefined }]);
            expect(r.error).toContain('column index 9 out of bounds (5 columns)');
        });

        it('rejects negative, fractional and unsafe indexes', () => {
            for (const index of [-1, 1.5, 1e21]) {
                const r = run([{ index, action: 'redact' }]);
                expect(r.calls).toEqual([]);
                expect(r.error).toContain('out of bounds (5 columns)');
            }
        });

        it('binds a name-only entry in a mixed document by header', () => {
            const r = run([
                { index: 0, action: 'keep' },
                { name: 'c', action: 'redact' },
            ]);
            expect(r.error).toBeUndefined();
            expect(r.applied).toBe(2);
            expect(r.calls[1]).toEqual({ index: 2, action: 'redact', canon: undefined });
        });

        it('binds a name differing only by case when there is no exact match', () => {
            const r = run([{ name: 'b', action: 'redact' }]);
            expect(r.calls).toEqual([{ index: 1, action: 'redact', canon: undefined }]);
        });

        it('prefers an exact header match over a case-insensitive one', () => {
            const { calls, apply } = recorder();
            importWithHeaders({ columns: [{ name: 'x', action: 'redact' }] }, ['X', 'x'], apply);
            expect(calls).toEqual([{ index: 1, action: 'redact', canon: undefined }]);
        });

        it('rejects an unknown name', () => {
            const r = run([
                { index: 0, action: 'keep' },
                { name: 'nope', action: 'redact' },
            ]);
            expect(r.calls).toHaveLength(1);
            expect(r.error).toContain('column "nope" not found in headers');
        });

        it('uses the index when both index and name are present', () => {
            const r = run([{ index: 3, name: 'a', action: 'redact' }]);
            expect(r.calls).toEqual([{ index: 3, action: 'redact', canon: undefined }]);
        });
    });
});
