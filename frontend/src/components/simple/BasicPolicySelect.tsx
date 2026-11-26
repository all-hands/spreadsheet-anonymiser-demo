import { BASIC_POLICY_OPTIONS, HASH_RUN_CHOICE, HASH_RUN_LABEL, HASH_UNKEYED_LABEL } from '../../types/policy';
import type { ColumnPolicy } from '../../types/policy';
import { choiceOf, policyOfChoice } from './chooser-policies';
import Explain from '../Explain';
import type { ExplanationKey } from '../../lib/explanations';

const SIMPLE_OPTIONS: Array<{ value: string; label: string }> = BASIC_POLICY_OPTIONS.flatMap((o) =>
    o.type === 'hash'
        ? [
              { value: HASH_RUN_CHOICE, label: HASH_RUN_LABEL },
              { value: 'hash', label: HASH_UNKEYED_LABEL },
          ]
        : [{ value: o.type, label: o.label }]
);

interface BasicPolicySelectProps {
    value: ColumnPolicy;
    colIndex: number;
    onChange: (colIndex: number, policy: ColumnPolicy) => void;
    ariaLabel?: string;
}

const BasicPolicySelect = ({ value, colIndex, onChange, ariaLabel }: BasicPolicySelectProps) => {
    const choice = choiceOf(value);
    const explain: ExplanationKey =
        choice === HASH_RUN_CHOICE ? 'choice:hash-run'
            : choice === 'hash' ? 'choice:hash-unkeyed'
                : (`policy:${value.type}` as ExplanationKey);
    return (
    <Explain k={explain}>
    <select
        value={choiceOf(value)}
        onChange={(e) => onChange(colIndex, policyOfChoice(e.target.value))}
        aria-label={ariaLabel}
        className="min-w-0 flex-1 bg-surface-2 border border-border rounded-sm px-1.5 py-1 text-xs text-foreground focus:outline-hidden focus:border-accent"
    >
        {SIMPLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
                {o.label}
            </option>
        ))}
    </select>
    </Explain>
    );
};

export default BasicPolicySelect;
