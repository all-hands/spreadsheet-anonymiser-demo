import { describe, expect, it } from 'vitest';
import { generalisationFallbacks } from './preview-hints';

describe('generalisationFallbacks', () => {
    it('names the column whose generalisation fell back to [REDACTED]', () => {
        const source = [['Bristol', '1980-01-01'], ['Leeds', '1990-02-02']];
        const shown = [['[REDACTED]', '1980'], ['[REDACTED]', '1990']];
        expect(generalisationFallbacks(source, shown, { 0: { type: 'year' }, 1: { type: 'year' } })).toEqual({
            0: 'Year needs dates; these cells are redacted.',
        });
    });
    it('ignores empty source cells and plain redact', () => {
        expect(generalisationFallbacks([[''], ['x']], [['[REDACTED]'], ['[REDACTED]']], { 0: { type: 'redact' } })).toEqual({});
        expect(generalisationFallbacks([['']], [['[REDACTED]']], { 0: { type: 'bucket' } })).toEqual({});
    });
    it('words the number range and age band cases', () => {
        const out = generalisationFallbacks([['a', 'b']], [['[REDACTED]', '[REDACTED]']], {
            0: { type: 'bucket' }, 1: { type: 'age-band' },
        });
        expect(out[0]).toMatch(/^Number range needs numbers/);
        expect(out[1]).toMatch(/^Age band needs dates of birth/);
    });
});
