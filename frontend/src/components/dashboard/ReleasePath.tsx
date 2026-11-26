import Explain from '../Explain';
import { describePlan, MAX_SUPPRESSION_BUDGET } from '../../lib/anonymity-plan';
import type { AnonymityPlan } from '../../lib/anonymity-plan';
import type { UndoSnapshot } from '../../store/advancedSessionStore';
import { FIELD } from './anonymity-styles';

const ReleasePath = ({
    qi, names, k, plan, budget, busy, planMsg, undo, onBudget, onMakePlan, onApply, onUndo,
}: {
    qi: number[];
    names: string[];
    k: number;
    plan: AnonymityPlan | null;
    budget: number;
    busy: boolean;
    planMsg: string;
    undo: UndoSnapshot | null;
    onBudget: (fraction: number) => void;
    onMakePlan: () => void;
    onApply: () => void;
    onUndo: () => void;
}) => (
            <div aria-label="Path to an anonymous release" className="border-t border-border pt-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Explain k="plan.title"><h4 className="font-medium text-foreground text-sm">Path to an anonymous release</h4></Explain>
                    <label className="flex items-center gap-1.5 text-xs">
                        Suppress at most
                        <Explain k="plan.budget">
                        <input
                            type="number"
                            min={0}
                            max={MAX_SUPPRESSION_BUDGET * 100}
                            step={1}
                            value={Math.round(budget * 100)}
                            onChange={(e) => onBudget(Number(e.target.value) / 100)}
                            aria-label="Suppression budget (percent of rows)"
                            className={`${FIELD} w-16`}
                        />
                        </Explain>
                        % of rows
                    </label>
                    <Explain k="plan.check">
                    <button
                        type="button"
                        onClick={onMakePlan}
                        disabled={busy || qi.length === 0}
                        className="px-3 py-1 rounded-sm border border-border text-foreground text-xs disabled:opacity-50"
                    >
                        {busy ? 'Working...' : 'Check what it takes'}
                    </button>
                    </Explain>
                </div>
                {qi.length === 0 ? (
                    <p className="text-xs text-warning">
                        No quasi-identifier is marked, so a plan cannot be made. Mark columns such as date of birth,
                        postcode, city or department as Quasi-identifier (the Role menu on each column in the grid).
                    </p>
                ) : plan ? null : (
                    <p className="text-xs text-foreground" data-testid="anonymity-summary">
                        {`A fully anonymous file is made by redacting direct identifiers (name, email, phone, ID) and generalising ${names.join(', ')} until every group has at least ${k} rows. Press Apply to find the least generalisation that works.`}
                    </p>
                )}
                <div>
                    <Explain k="plan.apply">
                    <button
                        type="button"
                        onClick={onApply}
                        disabled={busy || qi.length === 0}
                        className="px-3 py-1.5 rounded-sm bg-accent text-white text-xs font-medium disabled:opacity-50"
                    >
                        Apply optimal anonymisation selections
                    </button>
                    </Explain>
                </div>
                {plan && (
                    <div aria-label="Anonymisation plan" className="flex flex-col gap-2 text-xs">
                        {describePlan(plan).map((line) => (
                            <p key={line} className="text-foreground">{line}</p>
                        ))}
                        <p className="text-muted">
                            Searched from every quasi-identifier on Keep; the steps are the cheapest found, not a proof of the best file.
                            Anonymous release also redacts every direct identifier (Identifier role, or a detected email, phone, ID or card number) and any column that links back to people.
                        </p>
                    </div>
                )}
                {planMsg && <p role="status" className="text-xs text-foreground">{planMsg}</p>}
                {undo && (
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted">Last change: {undo.label}.</span>
                        <Explain k="bulk.undo">
                        <button
                            type="button"
                            onClick={onUndo}
                            className="px-2 py-1 rounded-sm border border-border text-foreground"
                        >
                            Undo
                        </button>
                        </Explain>
                    </div>
                )}
            </div>
    );

export default ReleasePath;
