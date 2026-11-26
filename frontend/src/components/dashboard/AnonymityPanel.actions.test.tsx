import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { measureMock, riskMock, planMock } = vi.hoisted(() => ({
    measureMock: vi.fn(), riskMock: vi.fn(), planMock: vi.fn(),
}));
vi.mock('../../lib/worker-client', () => ({
    createWorker: () => ({ measureAnonymity: measureMock, atRiskRows: riskMock, planAnonymity: planMock }),
}));

import AnonymityPanel from './AnonymityPanel';
import BulkPolicyBar from './BulkPolicyBar';
import { useDatasetStore } from '../../store/datasetStore';
import { useAdvancedSessionStore } from '../../store/advancedSessionStore';
import { releaseProblems, directIdentifierColumns, quasiIdentifiers } from '../../lib/anonymity';

const HEADERS = ['id', 'email', 'dob', 'city'];
const report = (below: number) => ({
    report: { k: 5, rows: 10, groups: 4, min_group: 1, rows_below_k: below, satisfied: below === 0, per_column: [] },
    claim: 'claim',
});
const PLAN = {
    k: 5, budget: 0.1, rows: 10, achievable: true, levels: [1, 0], rowsBelowK: 1, allowedRows: 1,
    steps: [{ column: 2, name: 'dob', policy: { type: 'year' }, dropped: false }],
};

beforeEach(() => {
    measureMock.mockReset();
    riskMock.mockReset();
    planMock.mockReset();
    useAdvancedSessionStore.setState({ measurement: null, plan: null, undo: null });
    useDatasetStore.getState().clearData();
    useDatasetStore.setState({ k: 5, suppressMode: 'cells' });
    useDatasetStore.getState().setFileData(
        HEADERS,
        Array.from({ length: 10 }, (_, i) => [String(i), `e${i}@x`, '1980-01-01', 'Bristol']),
        []
    );
    useDatasetStore.getState().initializePolicies(4);
});

describe('ignoring at-risk rows', () => {
    it('selects rows, excludes them with undo, and measures again', async () => {
        measureMock.mockResolvedValueOnce(report(3)).mockResolvedValueOnce(report(0));
        riskMock.mockResolvedValue([
            { row: 2, values: ['1990', 'Leeds'] },
            { row: 5, values: ['1991', 'Leeds'] },
            { row: 7, values: ['1992', 'Leeds'] },
        ]);
        render(<AnonymityPanel />);
        fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
        await waitFor(() => screen.getByLabelText('Anonymity result'));
        fireEvent.click(screen.getByRole('button', { name: 'Choose rows to ignore' }));
        await waitFor(() => screen.getByLabelText('At-risk rows'));
        expect(screen.getByRole('button', { name: /Ignore 0 selected/ })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
        expect(screen.getByRole('button', { name: 'Ignore 3 selected rows' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
        expect(screen.getByLabelText('Ignore row 6')).not.toBeChecked();
        fireEvent.click(screen.getByLabelText('Ignore row 6'));
        fireEvent.click(screen.getByRole('button', { name: 'Ignore 1 selected row' }));

        await waitFor(() => expect(measureMock).toHaveBeenCalledTimes(2));
        expect([...useDatasetStore.getState().excludedRows]).toEqual([5]);
        expect(measureMock.mock.calls[1][0]).toHaveLength(9);
        await waitFor(() => expect(screen.getByLabelText('Anonymity result')).toHaveTextContent('Rows below k=50'));

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(useDatasetStore.getState().excludedRows.size).toBe(0);
    });
});

describe('path to an anonymous release', () => {
    it('plans, applies the policies, switches release on and ends with no blockers; Undo restores', async () => {
        planMock.mockResolvedValue(PLAN);
        useDatasetStore.setState({ roles: { 0: 'identifier', 1: 'identifier', 2: 'quasi-identifier', 3: 'other' } });
        render(<AnonymityPanel />);
        fireEvent.click(screen.getByRole('button', { name: 'Check what it takes' }));
        await waitFor(() => screen.getByLabelText('Anonymisation plan'));
        expect(screen.getByLabelText('Anonymisation plan')).toHaveTextContent(/generalise "dob" to year/i);
        expect(planMock.mock.calls[0][4]).toEqual([2]);

        fireEvent.click(screen.getByRole('button', { name: 'Apply optimal anonymisation selections' }));
        const st = useDatasetStore.getState();
        expect(st.policies[2].type).toBe('year');
        expect(st.policies[0].type).toBe('redact');
        expect(st.policies[1].type).toBe('redact');
        expect(st.anonymousRelease).toBe(true);
        expect(
            releaseProblems({
                headers: HEADERS, policies: st.policies,
                request: { qi: quasiIdentifiers(st.roles, 4), identifiers: directIdentifierColumns(st.roles, 4, st.metadata), k: st.k, mode: st.suppressMode },
            })
        ).toEqual([]);

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(useDatasetStore.getState().policies[2].type).toBe('keep');
        expect(useDatasetStore.getState().anonymousRelease).toBe(false);
    });

    it('shows how a fully anonymous file is made before anything is pressed', () => {
        useDatasetStore.setState({ roles: { 0: 'identifier', 1: 'identifier', 2: 'quasi-identifier', 3: 'other' } });
        render(<AnonymityPanel />);
        expect(screen.getByTestId('anonymity-summary')).toHaveTextContent(/redacting direct identifiers.*"?dob"?|dob/);
        expect(screen.getByRole('button', { name: 'Apply optimal anonymisation selections' })).toBeEnabled();
    });

    it('Apply plans on click, redacts email/phone even when masked, and measures again to success', async () => {
        planMock.mockResolvedValue(PLAN);
        measureMock.mockResolvedValue(report(0));
        useDatasetStore.setState({
            roles: { 0: 'other', 1: 'other', 2: 'quasi-identifier', 3: 'other' },
            metadata: [{ index: 1, header: 'email', type: 'email', confidence: 1 }],
            policies: { 0: { type: 'keep' }, 1: { type: 'mask' }, 2: { type: 'keep' }, 3: { type: 'keep' } },
        });
        render(<AnonymityPanel />);
        fireEvent.click(screen.getByRole('button', { name: 'Apply optimal anonymisation selections' }));
        await waitFor(() => expect(screen.getByTestId('anonymity-success')).toBeInTheDocument());
        expect(useDatasetStore.getState().policies[1].type).toBe('redact');
        expect(useDatasetStore.getState().policies[2].type).toBe('year');
        expect(screen.queryByText(/Settings changed since the last measurement/)).toBeNull();
    });

    it('the release gate refuses a detected email left on mask', () => {
        const ids = directIdentifierColumns({ 0: 'other', 1: 'other' }, 2, [{ index: 1, header: 'e', type: 'email', confidence: 1 }]);
        expect(ids).toEqual([1]);
        expect(
            releaseProblems({
                headers: ['a', 'e'], policies: { 0: { type: 'keep' }, 1: { type: 'mask' } },
                request: { qi: [0], identifiers: ids, k: 5, mode: 'cells' },
            }).join(' ')
        ).toMatch(/Direct identifier columns must be redacted: "e" \(Mask\)/);
    });

    it('cannot plan without a quasi-identifier', () => {
        useDatasetStore.setState({ roles: { 0: 'other', 1: 'other', 2: 'other', 3: 'other' } });
        render(<AnonymityPanel />);
        expect(screen.getByRole('button', { name: 'Check what it takes' })).toBeDisabled();
    });
});

describe('presets', () => {
    it('Pseudonymise preset: identifiers hashed, sensitive kept, rest kept, undoable', () => {
        useDatasetStore.setState({ roles: { 0: 'identifier', 1: 'identifier', 2: 'sensitive', 3: 'other' } });
        render(<BulkPolicyBar headers={HEADERS} selected={new Set()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Pseudonymise preset' }));
        expect([0, 1, 2, 3].map((i) => useDatasetStore.getState().policies[i].type)).toEqual(['hash', 'hash', 'keep', 'keep']);
        fireEvent.click(screen.getByRole('button', { name: /^Undo Pseudonymise preset/ }));
        expect([0, 1, 2, 3].map((i) => useDatasetStore.getState().policies[i].type)).toEqual(['keep', 'keep', 'keep', 'keep']);
    });

    it('Anonymise preset plans and applies, sharing the optimal code', async () => {
        planMock.mockResolvedValue(PLAN);
        useDatasetStore.setState({ roles: { 0: 'identifier', 1: 'identifier', 2: 'quasi-identifier', 3: 'other' } });
        render(<BulkPolicyBar headers={HEADERS} selected={new Set()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Anonymise preset' }));
        await waitFor(() => expect(useDatasetStore.getState().anonymousRelease).toBe(true));
        expect(useDatasetStore.getState().policies[2].type).toBe('year');
        expect(useDatasetStore.getState().k).toBe(5);
    });

    it('Anonymise preset is off without a quasi-identifier and says why', () => {
        useDatasetStore.setState({ roles: { 0: 'other', 1: 'other', 2: 'other', 3: 'other' } });
        render(<BulkPolicyBar headers={HEADERS} selected={new Set()} />);
        expect(screen.getByRole('button', { name: 'Anonymise preset' })).toBeDisabled();
        expect(screen.getByText(/Off: no column is marked as a Quasi-identifier/)).toBeInTheDocument();
    });
});
