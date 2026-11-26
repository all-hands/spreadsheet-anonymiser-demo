import type { RowData } from '../types/data';
import type { ColumnPolicy } from '../types/policy';

const REDACTED = '[REDACTED]';

const NEEDS: Record<string, string> = {
    year: 'Year needs dates',
    'age-band': 'Age band needs dates of birth',
    bucket: 'Number range needs numbers',
};

export const generalisationFallbacks = (
    source: readonly RowData[],
    shown: readonly RowData[],
    policies: Record<number, ColumnPolicy>
): Record<number, string> => {
    const out: Record<number, string> = {};
    for (const [key, policy] of Object.entries(policies)) {
        const need = NEEDS[policy.type];
        if (!need) continue;
        const col = Number(key);
        const hit = shown.some((row, r) => {
            const src = source[r]?.[col];
            return row[col] === REDACTED && src !== null && src !== undefined && String(src).trim() !== '';
        });
        if (hit) out[col] = `${need}; these cells are redacted.`;
    }
    return out;
};
