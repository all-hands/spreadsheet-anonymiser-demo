import { beforeEach, describe, expect, it } from 'vitest';
import { finishRun } from './pipeline';
import type { RunDeps } from './pipeline';
import { PARSE, makeFile, makeWorker, makeSink, installArtifactMocks } from '../test/pipeline-fakes';
import type { ReleaseCheck } from '../types/anonymity';
import type { AuditLog } from '../types/audit';

const REPORT = { k: 2, rows: 2, groups: 1, min_group: 2, rows_below_k: 0, satisfied: true, per_column: [] };
const check = (passed: boolean): ReleaseCheck => ({
    before: { ...REPORT, min_group: 1, rows_below_k: 2, satisfied: false, per_column: [{ column: 0, rows_below_k_without: 0, min_group_without: 2 }] },
    report: passed ? REPORT : { ...REPORT, rows: 0, satisfied: false },
    claim: passed ? 'Measured: every combination of joined ...' : 'No rows to measure on joined.',
    suppression: {
        k: 2, mode: 'cells', rows_in: 2, rows_suppressed: 1, cells_suppressed: 1, rows_dropped: 0,
        groups_before: 2, min_group_before: 1, groups_after: 1, min_group_after: 2,
    },
    passed,
});

const REQ = { qi: [2], identifiers: [1], k: 2, mode: 'cells' as const };
const POLICIES = { 0: { type: 'redact' as const }, 1: { type: 'redact' as const }, 2: { type: 'year' as const } };

const setup = (passed: boolean) => {
    const trace: string[] = [];
    const { worker, calls } = makeWorker(trace);
    let suppressArgs: unknown[] = [];
    let log: AuditLog | null = null;
    const base = makeSink(trace);
    const audit = {
        ...base,
        startNewLog: (...a: Parameters<typeof base.startNewLog>) => base.startNewLog(...a),
        getLog: () => {
            const l = base.getLog();
            return l ? { ...l, anonymity: log?.anonymity } : l;
        },
        setAnonymity: (a: NonNullable<AuditLog['anonymity']>) => {
            trace.push('setAnonymity');
            log = { anonymity: a } as AuditLog;
        },
    };
    const deps: RunDeps = {
        worker: {
            ...worker,
            suppressForRelease: async (...args) => {
                trace.push('suppress');
                suppressArgs = args;
                return { data: [['SUPPRESSED']], check: check(passed) };
            },
        },
        audit,
        onStatus: () => {},
    };
    return { trace, deps, calls, args: () => suppressArgs, log: () => log };
};

beforeEach(() => {
    installArtifactMocks();
});

describe('finishRun with an anonymous release', () => {
    it('suppresses after the policies, records the statement, exports the suppressed rows, no salt', async () => {
        const { trace, deps, calls, args, log } = setup(true);
        const { artifacts } = await finishRun(
            { file: makeFile('d.csv'), policies: POLICIES, salt: new Uint8Array(32), anonymity: REQ },
            deps,
            PARSE
        );
        expect(trace.indexOf('anonymize')).toBeLessThan(trace.indexOf('suppress'));
        expect(trace.indexOf('suppress')).toBeLessThan(trace.indexOf('generate'));
        expect(trace.indexOf('setAnonymity')).toBeLessThan(trace.indexOf('completeLog'));
        expect(args().slice(2)).toEqual([[2], 2, 'cells']);
        expect(calls.generateRows).toEqual([['SUPPRESSED']]);
        expect(log()?.anonymity?.statement).toBe('k-anonymity k=2 measured, local suppression applied');
        expect(log()?.anonymity?.quasiIdentifiers).toEqual(['joined']);
        expect(artifacts.map((a) => a.name)).toEqual(['anonymized-d.csv', 'd_audit.json']);
    });

    it('refuses a detected email left on mask even when the page listed no identifiers', async () => {
        const { trace, deps } = setup(true);
        await expect(
            finishRun(
                {
                    file: makeFile('d.csv'),
                    policies: { 0: { type: 'redact' as const }, 1: { type: 'mask' as const }, 2: { type: 'year' as const } },
                    anonymity: { ...REQ, identifiers: [] },
                },
                deps,
                PARSE
            )
        ).rejects.toThrow(/Direct identifier columns must be redacted: "email" \(Mask\)/);
        expect(trace).not.toContain('generate');
    });

    it('refuses a column whose header names an identifier even when its cells were not detected', async () => {
        const { trace, deps } = setup(true);
        await expect(
            finishRun(
                {
                    file: makeFile('d.csv'),
                    policies: { 1: { type: 'redact' as const }, 2: { type: 'year' as const } },
                    anonymity: { ...REQ, identifiers: [] },
                },
                deps,
                { ...PARSE, metadata: PARSE.metadata.map((m) => (m.index === 0 ? { ...m, header: 'name', type: 'text' as const } : m)) }
            )
        ).rejects.toThrow(/Direct identifier columns must be redacted: "name" \(Keep\)/);
        expect(trace).not.toContain('generate');
    });

    it('blocks the export when the check fails: no file, failed log, columns named', async () => {
        const { trace, deps } = setup(false);
        await expect(
            finishRun({ file: makeFile('d.csv'), policies: POLICIES, anonymity: REQ }, deps, PARSE)
        ).rejects.toThrow(/Export blocked: the anonymity check did not pass on joined/);
        expect(trace).toContain('failLog');
        expect(trace).not.toContain('generate');
        expect(trace).not.toContain('setAnonymity');
        expect(trace).not.toContain('completeLog');
    });

    it('refuses a re-linkable policy before anything starts (no log touched)', async () => {
        const { trace, deps } = setup(true);
        await expect(
            finishRun(
                { file: makeFile('d.csv'), policies: { ...POLICIES, 0: { type: 'hash' } }, anonymity: REQ },
                deps,
                PARSE
            )
        ).rejects.toThrow(/"name" \(Hash\)/);
        expect(trace).toEqual([]);
    });

    it('refuses a streamed file', async () => {
        const { trace, deps } = setup(true);
        await expect(
            finishRun({ file: makeFile('d.csv'), policies: POLICIES, anonymity: REQ }, deps, { ...PARSE, streamed: true })
        ).rejects.toThrow(/streamed/);
        expect(trace).toEqual([]);
    });

    it('without the option the run is unchanged (salt kept, no suppression)', async () => {
        const { trace, deps } = setup(true);
        const { artifacts } = await finishRun(
            { file: makeFile('d.csv'), policies: POLICIES, salt: new Uint8Array(32) },
            deps,
            PARSE
        );
        expect(trace).not.toContain('suppress');
        expect(artifacts.map((a) => a.name)).toContain('anonymized-d.csv.salt');
    });
});
