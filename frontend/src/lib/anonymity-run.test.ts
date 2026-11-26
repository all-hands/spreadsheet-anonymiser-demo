import { beforeEach, describe, expect, it } from 'vitest';
import { useDatasetStore } from '../store/datasetStore';
import { useAdvancedSessionStore } from '../store/advancedSessionStore';
import { applyPseudonymisePreset, isFreeTextColumn, pseudonymisePolicies } from './anonymity-run';

beforeEach(() => {
    useAdvancedSessionStore.setState({ undo: null });
    useDatasetStore.getState().clearData();
    useDatasetStore.getState().setFileData(['email', 'note'], [['a@x.org', 'short']], []);
    useDatasetStore.getState().initializePolicies(2);
});

describe('applyPseudonymisePreset', () => {
    it('keeps the canon of an identifier column it retypes to hash', () => {
        useDatasetStore.setState({
            roles: { 0: 'identifier', 1: 'other' },
            policies: { 0: { type: 'keep', canon: 'email' }, 1: { type: 'keep' } },
        });
        applyPseudonymisePreset();
        expect(useDatasetStore.getState().policies[0]).toEqual({ type: 'hash', canon: 'email' });
        expect(useAdvancedSessionStore.getState().undo?.label).toBe('Pseudonymise preset');
    });
});

describe('pseudonymisePolicies', () => {
    it('uses only vocabulary policies by role', () => {
        const out = pseudonymisePolicies({
            roles: { 0: 'identifier', 1: 'quasi-identifier', 2: 'sensitive', 3: 'other', 4: 'other' },
            freeText: { 4: true },
            count: 5,
        });
        expect(Object.values(out).map((p) => p.type)).toEqual(['hash', 'keep', 'keep', 'keep', 'redact']);
    });
});

describe('isFreeTextColumn', () => {
    it('flags long multi-word cells only', () => {
        const note = 'Patient reported mild symptoms after the second dose of the course';
        expect(isFreeTextColumn([note, note, 'ok'])).toBe(true);
        expect(isFreeTextColumn(['Bristol', 'Leeds'])).toBe(false);
        expect(isFreeTextColumn([])).toBe(false);
    });
});
