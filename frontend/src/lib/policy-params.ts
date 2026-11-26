import { DEFAULT_GENERALISE_WIDTH, type ColumnPolicy, type PolicyType } from '../types/policy';

export const takesWidth = (t: PolicyType): boolean => t === 'age-band' || t === 'bucket';
export const takesReferenceDate = (t: PolicyType): boolean => t === 'age-band';

export const defaultReferenceDate = (now: Date = new Date()): string =>
    `${String(now.getFullYear()).padStart(4, '0')}-01-01`;

export const isIsoDate = (s: unknown): s is string => {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    if (y < 1 || m < 1 || m > 12 || d < 1) return false;
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d <= days[m - 1];
};

export const isWidth = (n: unknown): n is number =>
    typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 0xffffffff;

export const retype = (type: PolicyType, prev?: ColumnPolicy): ColumnPolicy => {
    const next: ColumnPolicy = { type };
    if (prev?.canon) next.canon = prev.canon;
    if (takesWidth(type) && prev?.width !== undefined) next.width = prev.width;
    if (takesReferenceDate(type)) next.referenceDate = prev?.referenceDate ?? defaultReferenceDate();
    return next;
};

export const policyDetails = (p: ColumnPolicy | undefined): string | undefined => {
    if (!p || !takesWidth(p.type)) return undefined;
    const width = `width ${p.width ?? DEFAULT_GENERALISE_WIDTH}`;
    return takesReferenceDate(p.type) ? `${width}, reference date ${p.referenceDate ?? '(unset)'}` : width;
};
