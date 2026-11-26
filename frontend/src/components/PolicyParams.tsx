import { isIsoDate, takesReferenceDate, takesWidth } from '../lib/policy-params';
import { DEFAULT_GENERALISE_WIDTH } from '../types/policy';
import type { ColumnPolicy } from '../types/policy';
import Explain from './Explain';

interface PolicyParamsProps {
    policy: ColumnPolicy | undefined;
    name: string;
    onChange: (params: Pick<ColumnPolicy, 'width' | 'referenceDate'>) => void;
}

const INPUT =
    'bg-surface-2 border border-border rounded-sm px-1.5 py-1 text-xs text-foreground focus:outline-hidden focus:border-accent';

const PolicyParams = ({ policy, name, onChange }: PolicyParamsProps) => {
    if (!policy || !takesWidth(policy.type)) return null;
    const dateOk = isIsoDate(policy.referenceDate);
    return (
        <>
            <Explain k="param.width">
            <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={policy.width ?? ''}
                placeholder={`width ${DEFAULT_GENERALISE_WIDTH}`}
                onChange={(e) => {
                    const n = e.target.valueAsNumber;
                    onChange({ width: Number.isInteger(n) && n >= 1 ? n : undefined });
                }}
                aria-label={`Width for ${name}`}
                className={`w-24 ${INPUT}`}
            />
            </Explain>
            {takesReferenceDate(policy.type) && (
                <Explain k="param.refdate">
                <input
                    type="date"
                    value={policy.referenceDate ?? ''}
                    onChange={(e) => onChange({ referenceDate: e.target.value || undefined })}
                    aria-label={`Reference date for ${name}`}
                    aria-invalid={!dateOk}
                    className={`${INPUT} ${dateOk ? '' : 'border-danger'}`}
                />
                </Explain>
            )}
        </>
    );
};

export default PolicyParams;
