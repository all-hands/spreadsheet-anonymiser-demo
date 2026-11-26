import type { ColumnMetadata, ColumnType } from '../types/data';

const luhnValid = (digits: string): boolean => {
    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let d = digits.charCodeAt(i) - 48;
        if (double) {
            d *= 2;
            if (d > 9) d -= 9;
        }
        sum += d;
        double = !double;
    }
    return sum % 10 === 0;
};

const isPaymentCard = (cell: string): boolean => luhnValid(cell.replace(/[ -]/g, ''));

const DATE_REGEX =
    /^(?:\d{4}([-/.])(?:0[1-9]|1[0-2])\1(?:0[1-9]|[12]\d|3[01])(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?|(?:0?[1-9]|[12]\d|3[01])([-/.])(?:0?[1-9]|1[0-2])\2\d{4}|(?:0?[1-9]|1[0-2])([-/.])(?:0?[1-9]|[12]\d|3[01])\3\d{4})$/;

export const isDateValue = (cell: string): boolean => DATE_REGEX.test(cell.trim());

const DETECTORS: Array<{ type: ColumnType; regex: RegExp; accept?: (cell: string) => boolean }> = [
    { type: 'email', regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
    { type: 'ssn', regex: /^\d{3}-\d{2}-\d{4}$/ },
    { type: 'credit-card', regex: /^(?:\d[ -]*?){13,16}$/, accept: isPaymentCard },
    {
        type: 'ip',
        regex: /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
    },
    { type: 'url', regex: /^https?:\/\/[^\s]+$/i },
    { type: 'date', regex: DATE_REGEX },
    { type: 'phone', regex: /^\+?[\d\s()-]{10,17}$/ },
];

export const analyzeColumns = (headers: string[], data: unknown[][]): ColumnMetadata[] => {
    const sample = data.slice(0, 100);

    return headers.map((header, colIndex) => {
        const scores = new Map<ColumnType, number>(DETECTORS.map(({ type }) => [type, 0]));
        let nonEmptyCount = 0;

        sample.forEach((row) => {
            const value = Array.isArray(row) ? row[colIndex] : null;

            if (value != null && value !== '') {
                const str = String(value).trim();
                nonEmptyCount++;

                const hit = DETECTORS.find(({ regex, accept }) => regex.test(str) && (accept?.(str) ?? true));
                if (hit) scores.set(hit.type, (scores.get(hit.type) ?? 0) + 1);
            }
        });

        let type: ColumnType = 'text';
        let confidence = 0;
        const threshold = 0.5;

        if (nonEmptyCount > 0) {
            for (const [typeName, score] of scores) {
                const ratio = score / nonEmptyCount;
                if (ratio > threshold && ratio > confidence) {
                    type = typeName;
                    confidence = ratio;
                }
            }
        }

        return { index: colIndex, header, type, confidence };
    });
};
