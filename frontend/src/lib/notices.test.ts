import { describe, expect, it } from 'vitest';
import { K_ANONYMITY_LIMITS, PSEUDONYMISED_LINE, noticeFor } from './notices';

describe('noticeFor', () => {
    it('is the pseudonymisation notice unless a passed check is supplied', () => {
        expect(noticeFor().line).toBe(PSEUDONYMISED_LINE);
        expect(noticeFor(null).variant).toBe('pseudonymised');
    });

    it('switches to the measured wording, with the limits, when a check passed', () => {
        const n = noticeFor({ k: 5, mode: 'cells', quasiIdentifiers: ['dob', 'city'] });
        expect(n.variant).toBe('k-anonymity');
        expect(n.line).toContain('k-anonymity k=5 measured, local suppression applied');
        expect(n.line).toContain('dob, city');
        expect(n.line).toMatch(/not a finding that the data is anonymous/);
        expect(n.line).not.toBe(PSEUDONYMISED_LINE);
        expect(n.detail).toBe(K_ANONYMITY_LIMITS);
        expect(n.detail).toMatch(/linkage with other datasets/);
        expect(n.detail).toMatch(/free-text/);
        expect(n.detail).toMatch(/small files/);
    });
});
