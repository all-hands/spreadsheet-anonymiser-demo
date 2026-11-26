import { useMemo, useState } from 'react';
import { useDatasetStore } from '../../store/datasetStore';
import { useAdvancedSessionStore } from '../../store/advancedSessionStore';
import { createWorker } from '../../lib/worker-client';
import { filterRows, optsOf } from '../../lib/pipeline-common';
import { directIdentifierColumns, quasiIdentifiers, rankedOffenders, releaseProblems } from '../../lib/anonymity';
import { applyOptimal, computePlan, ignoreAtRiskRows, measureInputKey, measureNow, planKey } from '../../lib/anonymity-run';
import type { AtRiskRow } from '../../workers/anonymity-plan';
import { MAX_K, MIN_K, SUPPRESS_MODES } from '../../types/anonymity';
import Explain from '../Explain';
import AnonymityResult from './AnonymityResult';
import AtRiskPicker from './AtRiskPicker';
import ReleasePath from './ReleasePath';
import ReleaseSwitch from './ReleaseSwitch';
import { FIELD } from './anonymity-styles';
import type { SuppressMode } from '../../types/anonymity';

const MODE_LABELS: Record<SuppressMode, string> = {
    cells: 'Replace cells with * (local suppression)',
    rows: 'Drop the rows (record suppression)',
};

const AnonymityPanel = ({ streamed = false }: { streamed?: boolean }) => {
    const s = useDatasetStore();
    const { headers, roles, policies, k, suppressMode, anonymousRelease } = s;
    const result = useAdvancedSessionStore((st) => st.measurement);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [kDraft, setKDraft] = useState<string | null>(null);
    const commitK = () => {
        if (kDraft !== null) s.setK(Number(kDraft));
        setKDraft(null);
    };

    const qi = useMemo(() => quasiIdentifiers(roles, headers.length), [roles, headers.length]);
    const names = qi.map((i) => headers[i]);
    const problems = releaseProblems({
        headers,
        policies,
        request: { qi, identifiers: directIdentifierColumns(roles, headers.length, s.metadata), k, mode: suppressMode },
        streamed,
    });
    const inputKey = measureInputKey(s);
    const fresh = result && result.key === inputKey ? result.value : null;

    const measure = async () => {
        if (quasiIdentifiers(useDatasetStore.getState().roles, useDatasetStore.getState().headers.length).length === 0) return;
        commitK();
        setBusy(true);
        setError('');
        try {
            await measureNow();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setBusy(false);
        }
    };

    const [risk, setRisk] = useState<{ key: string; rows: AtRiskRow[]; originals: number[] } | null>(null);
    const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
    const [ignoreMsg, setIgnoreMsg] = useState('');
    const loadRisk = async () => {
        const st = useDatasetStore.getState();
        const qiNow = quasiIdentifiers(st.roles, st.headers.length);
        setBusy(true);
        setError('');
        try {
            const originals = st.data.map((_, i) => i).filter((i) => !st.excludedRows.has(i));
            const parse = filterRows({ headers: st.headers, data: st.data, metadata: st.metadata }, st.excludedRows);
            const rows = await createWorker().atRiskRows(
                parse.data, parse.headers, parse.metadata, st.policies,
                optsOf({ dataset: st.dataset, tokenEncoding: st.tokenEncoding }), qiNow, st.k
            );
            setRisk({ key: inputKey, rows, originals });
            setPicked(new Set());
            setIgnoreMsg('');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setBusy(false);
        }
    };
    const riskFresh = risk && risk.key === inputKey ? risk : null;
    const ignorePicked = async () => {
        if (!riskFresh || picked.size === 0) return;
        const n = picked.size;
        ignoreAtRiskRows(picked);
        setPicked(new Set());
        setRisk(null);
        setIgnoreMsg(`Ignoring ${n} row${n === 1 ? '' : 's'}: they are left out of the output. Measured again below.`);
        await measure();
    };

    const planState = useAdvancedSessionStore((st) => st.plan);
    const budget = useAdvancedSessionStore((st) => st.suppressionBudget);
    const undo = useAdvancedSessionStore((st) => st.undo);
    const [planMsg, setPlanMsg] = useState('');
    const currentPlanKey = planKey();
    const plan = planState && planState.key === currentPlanKey ? planState.value : null;
    const makePlan = async () => {
        setBusy(true);
        setError('');
        setPlanMsg('');
        try {
            await computePlan();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setBusy(false);
        }
    };
    const onApply = async () => {
        setBusy(true);
        setError('');
        setPlanMsg('');
        try {
            setPlanMsg(await applyOptimal({ plan }));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setBusy(false);
        }
    };

    if (headers.length === 0) return null;

    const offenders = fresh ? rankedOffenders(fresh.report, headers).slice(0, 3) : [];
    const measureBlocker = streamed
        ? 'Unavailable for streamed files (see below).'
        : qi.length === 0
          ? 'Mark at least one column as Quasi-identifier (the Role menu on that column in the grid) to measure.'
          : '';
    const measureBlocked = measureBlocker !== '';

    return (
        <section aria-label="Anonymity check" className="rounded-xl border border-border bg-surface p-4 flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Explain k="anon.title"><h3 className="font-semibold text-foreground">Anonymity check</h3></Explain>
                <label className="flex items-center gap-1.5 text-xs">
                    k
                    <Explain k="anon.k">
                    <input
                        type="number"
                        min={MIN_K}
                        max={MAX_K}
                        value={kDraft ?? k}
                        onChange={(e) => {
                            setKDraft(e.target.value);
                            const n = Number(e.target.value);
                            if (e.target.value.trim() !== '' && Number.isInteger(n) && n >= MIN_K && n <= MAX_K) s.setK(n);
                        }}
                        onBlur={commitK}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitK();
                        }}
                        aria-label="Target k"
                        className={`${FIELD} w-16`}
                    />
                    </Explain>
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                    Small groups
                    <Explain k={`suppress:${suppressMode}`}>
                    <select
                        value={suppressMode}
                        onChange={(e) => s.setSuppressMode(e.target.value as SuppressMode)}
                        aria-label="Suppression mode"
                        className={FIELD}
                    >
                        {SUPPRESS_MODES.map((m) => (
                            <option key={m} value={m}>{MODE_LABELS[m]}</option>
                        ))}
                    </select>
                    </Explain>
                </label>
                <Explain k="anon.measure">
                <button
                    type="button"
                    onClick={measure}
                    disabled={busy || measureBlocked}
                    aria-describedby={measureBlocked ? 'anonymity-measure-hint' : undefined}
                    className="px-3 py-1 rounded-sm bg-accent text-white text-xs disabled:opacity-50"
                >
                    {busy ? 'Measuring...' : 'Measure'}
                </button>
                </Explain>
            </div>

            {measureBlocked && (
                <p id="anonymity-measure-hint" role="status" className="text-xs text-warning">
                    Measure is off: {measureBlocker}
                </p>
            )}

            <p className="text-xs text-muted">
                Quasi-identifiers: {names.length ? names.join(', ') : 'none marked yet'}. Measured on the values as they
                would be exported (after the column policies).
            </p>

            {streamed && (
                <p role="alert" className="text-xs text-warning">
                    Unavailable: this file is streamed (over 32 MiB), so its quasi-identifiers cannot be measured in the
                    browser and an anonymous release is blocked. Use the command-line tool with --quasi-identifiers and
                    --min-group.
                </p>
            )}
            {error && <p role="alert" className="text-xs text-danger">Error: {error}</p>}

            <AnonymityResult
                fresh={fresh}
                hasStale={!!result}
                offenders={offenders}
                suppressMode={suppressMode}
                atRisk={fresh && (
                    <AtRiskPicker
                        report={fresh.report}
                        streamed={streamed}
                        busy={busy}
                        risk={riskFresh}
                        picked={picked}
                        ignoreMsg={ignoreMsg}
                        onLoad={loadRisk}
                        onPickedChange={setPicked}
                        onIgnore={ignorePicked}
                    />
                )}
            />

            {!streamed && (
                <ReleasePath
                    qi={qi}
                    names={names}
                    k={k}
                    plan={plan}
                    budget={budget}
                    busy={busy}
                    planMsg={planMsg}
                    undo={undo}
                    onBudget={(f) => useAdvancedSessionStore.getState().setSuppressionBudget(f)}
                    onMakePlan={makePlan}
                    onApply={onApply}
                    onUndo={() => {
                        useAdvancedSessionStore.getState().undoLast();
                        setPlanMsg(`Undone: ${undo?.label}.`);
                    }}
                />
            )}

            <ReleaseSwitch
                anonymousRelease={anonymousRelease}
                problems={problems}
                onChange={s.setAnonymousRelease}
            />
        </section>
    );
};

export default AnonymityPanel;
