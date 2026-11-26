import { describe, it, expect, beforeEach } from 'vitest';
import { useDatasetStore } from './datasetStore';
import type { ColumnMetadata } from '../types/data';

const META: ColumnMetadata[] = [
    { index: 0, header: 'name', type: 'text', confidence: 1 },
    { index: 1, header: 'email', type: 'email', confidence: 1 },
];

describe('datasetStore row exclusions', () => {
    beforeEach(() => {
        useDatasetStore.setState({
            excludedRows: new Set(),
            headers: [],
            data: [],
            metadata: [],
            policies: {},
        });
    });

    it('toggleRowExclusion adds a row index', () => {
        useDatasetStore.getState().toggleRowExclusion(3);

        const { excludedRows } = useDatasetStore.getState();
        expect(excludedRows.size).toBe(1);
        expect(excludedRows.has(3)).toBe(true);
    });

    it('toggleRowExclusion removes an already-excluded index', () => {
        useDatasetStore.getState().toggleRowExclusion(3);
        useDatasetStore.getState().toggleRowExclusion(3);

        expect(useDatasetStore.getState().excludedRows.size).toBe(0);
    });

    it('replaces the Set instead of mutating it (zustand set replaces state)', () => {
        useDatasetStore.setState({ excludedRows: new Set([1]) });
        const before = useDatasetStore.getState().excludedRows;

        useDatasetStore.getState().toggleRowExclusion(2);
        const after = useDatasetStore.getState().excludedRows;

        expect(after).not.toBe(before);
        expect(before.has(2)).toBe(false);
        expect([...after].sort()).toEqual([1, 2]);
    });

    it('clearRowExclusions empties the set', () => {
        useDatasetStore.getState().toggleRowExclusion(0);
        useDatasetStore.getState().toggleRowExclusion(4);
        useDatasetStore.getState().clearRowExclusions();

        expect(useDatasetStore.getState().excludedRows.size).toBe(0);
    });

    it('setFileData resets exclusions — a new file inherits no stale indices', () => {
        useDatasetStore.getState().toggleRowExclusion(0);
        useDatasetStore.getState().setFileData(['name', 'email'], [['Ann', 'a@x.com']], META);

        expect(useDatasetStore.getState().excludedRows.size).toBe(0);
    });

    it('clearData resets exclusions too', () => {
        useDatasetStore.getState().toggleRowExclusion(0);
        useDatasetStore.getState().clearData();

        expect(useDatasetStore.getState().excludedRows.size).toBe(0);
    });
});

describe('datasetStore generalisation parameters', () => {
    beforeEach(() => {
        useDatasetStore.setState({ policies: { 0: { type: 'keep' } } });
    });

    it('age-band arrives with a visible default reference date', () => {
        useDatasetStore.getState().setPolicy(0, 'age-band');
        const p = useDatasetStore.getState().policies[0];
        expect(p.type).toBe('age-band');
        expect(p.referenceDate).toMatch(/^\d{4}-01-01$/);
    });

    it('setParams merges and clears parameters', () => {
        const { setPolicy, setParams } = useDatasetStore.getState();
        setPolicy(0, 'age-band');
        setParams(0, { width: 5, referenceDate: '2020-01-01' });
        expect(useDatasetStore.getState().policies[0]).toEqual({
            type: 'age-band',
            width: 5,
            referenceDate: '2020-01-01',
        });
        setParams(0, { width: undefined });
        expect(useDatasetStore.getState().policies[0].width).toBeUndefined();
        expect(useDatasetStore.getState().policies[0].referenceDate).toBe('2020-01-01');
    });

    it('re-typing drops parameters that no longer apply, keeps the canon type', () => {
        const { setPolicy, setParams, setCanon } = useDatasetStore.getState();
        setCanon(0, 'email');
        setPolicy(0, 'age-band');
        setParams(0, { width: 5 });
        setPolicy(0, 'year');
        expect(useDatasetStore.getState().policies[0]).toEqual({ type: 'year', canon: 'email' });
    });
});

describe('datasetStore setPolicies', () => {
    beforeEach(() => {
        useDatasetStore.setState({
            policies: { 0: { type: 'keep' }, 1: { type: 'keep' }, 2: { type: 'hash' } },
        });
    });

    it('retypes every listed column and leaves the others alone', () => {
        useDatasetStore.getState().setPolicies([0, 1], 'redact');
        const { policies } = useDatasetStore.getState();
        expect(policies[0].type).toBe('redact');
        expect(policies[1].type).toBe('redact');
        expect(policies[2].type).toBe('hash');
    });

    it('applies once: a single store update for many columns', () => {
        let updates = 0;
        const unsub = useDatasetStore.subscribe(() => { updates += 1; });
        useDatasetStore.getState().setPolicies([0, 1, 2], 'redact');
        unsub();
        expect(updates).toBe(1);
    });

    it('drops parameters that no longer apply, like setPolicy', () => {
        useDatasetStore.setState({ policies: { 0: { type: 'bucket', width: 5 } } });
        useDatasetStore.getState().setPolicies([0], 'hash');
        expect(useDatasetStore.getState().policies[0].width).toBeUndefined();
    });

    it('applies width and reference date to every affected column', () => {
        useDatasetStore.getState().setPolicies([0, 1], 'age-band', { width: 5, referenceDate: '2026-01-01' });
        const { policies } = useDatasetStore.getState();
        for (const i of [0, 1]) {
            expect(policies[i]).toMatchObject({ type: 'age-band', width: 5, referenceDate: '2026-01-01' });
        }
    });

    it('an empty list is a no-op for policies', () => {
        useDatasetStore.getState().setPolicies([], 'redact');
        expect(useDatasetStore.getState().policies[0].type).toBe('keep');
    });
});

describe('datasetStore roles and anonymity settings', () => {
    const HEADERS = ['id', 'dob', 'city', 'salary', 'age'];
    const META: ColumnMetadata[] = [
        { index: 1, header: 'dob', type: 'date', confidence: 1 },
    ];
    beforeEach(() => {
        useDatasetStore.setState({
            headers: [], data: [], metadata: [], policies: {}, roles: {},
            anonymousRelease: false, k: 5, suppressMode: 'cells', excludedRows: new Set(),
        });
    });

    it('pre-selects roles from the headers when a file is loaded', () => {
        useDatasetStore.getState().setFileData(HEADERS, [], META);
        expect(useDatasetStore.getState().roles).toEqual({
            0: 'identifier', 1: 'quasi-identifier', 2: 'quasi-identifier', 3: 'sensitive', 4: 'quasi-identifier',
        });
    });

    it('setRole changes one column and replaces the object', () => {
        useDatasetStore.getState().setFileData(HEADERS, [], META);
        const before = useDatasetStore.getState().roles;
        useDatasetStore.getState().setRole(2, 'other');
        const after = useDatasetStore.getState().roles;
        expect(after[2]).toBe('other');
        expect(after).not.toBe(before);
        expect(before[2]).toBe('quasi-identifier');
    });

    it('applyRolePolicies suggests per role, only on explicit call, and reports changes', () => {
        const rows = [['1', '1980-01-01', 'Bristol', '5', '31'], ['2', '1990-02-02', 'Leeds', '6', '41']];
        useDatasetStore.getState().setFileData(HEADERS, rows, [{ index: 1, header: 'dob', type: 'phone', confidence: 1 }]);
        useDatasetStore.getState().initializePolicies(HEADERS.length);
        expect(useDatasetStore.getState().policies[0].type).toBe('keep');
        useDatasetStore.getState().setPolicy(3, 'hash');

        const changed = useDatasetStore.getState().applyRolePolicies();
        const p = useDatasetStore.getState().policies;
        expect(p[0].type).toBe('redact');
        expect(p[1].type).toBe('year');
        expect(p[2].type).toBe('keep');
        expect(p[3].type).toBe('keep');
        expect(p[4].type).toBe('bucket');
        expect(changed).toBe(4);
        expect(useDatasetStore.getState().applyRolePolicies()).toBe(0);
    });

    it('defaults: k=5, cells, switch off; k is clamped to 2..50', () => {
        const s = useDatasetStore.getState();
        expect([s.k, s.suppressMode, s.anonymousRelease]).toEqual([5, 'cells', false]);
        s.setK(1);
        expect(useDatasetStore.getState().k).toBe(2);
        s.setK(500);
        expect(useDatasetStore.getState().k).toBe(50);
        s.setK(Number.NaN);
        expect(useDatasetStore.getState().k).toBe(5);
        s.setK(7.4);
        expect(useDatasetStore.getState().k).toBe(7);
    });

    it('a new file switches anonymous release off; k and mode persist', () => {
        const s = useDatasetStore.getState();
        s.setAnonymousRelease(true);
        s.setK(8);
        s.setSuppressMode('rows');
        useDatasetStore.getState().setFileData(HEADERS, [], META);
        const n = useDatasetStore.getState();
        expect([n.anonymousRelease, n.k, n.suppressMode]).toEqual([false, 8, 'rows']);
    });

    it('clearData drops roles', () => {
        useDatasetStore.getState().setFileData(HEADERS, [], META);
        useDatasetStore.getState().clearData();
        expect(useDatasetStore.getState().roles).toEqual({});
    });
});
