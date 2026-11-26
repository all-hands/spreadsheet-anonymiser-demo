import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { measureMock } = vi.hoisted(() => ({ measureMock: vi.fn() }));
vi.mock('../../lib/worker-client', () => ({
    createWorker: () => ({ measureAnonymity: measureMock }),
}));

import AnonymityPanel from './AnonymityPanel';
import { useDatasetStore } from '../../store/datasetStore';

const HEADERS = ['id', 'email', 'dob', 'city'];
const RESULT = {
    report: {
        k: 5, rows: 10, groups: 4, min_group: 1, rows_below_k: 6, satisfied: false,
        per_column: [
            { column: 2, rows_below_k_without: 4, min_group_without: 2 },
            { column: 3, rows_below_k_without: 0, min_group_without: 5 },
        ],
    },
    claim: 'Not k-anonymous at k=5: 6 of 10 rows share ...',
};

const load = () => {
    useDatasetStore.getState().setFileData(HEADERS, [['1', 'a@x', '1980-01-01', 'Bristol']], []);
    useDatasetStore.getState().initializePolicies(4);
};

beforeEach(() => {
    measureMock.mockReset();
    measureMock.mockResolvedValue(RESULT);
    useDatasetStore.getState().clearData();
    useDatasetStore.setState({ k: 5, suppressMode: 'cells' });
    load();
});

describe('AnonymityPanel with nothing to measure', () => {
    it('says why Measure is off instead of silently greying it', () => {
        useDatasetStore.getState().setFileData(['a', 'b'], [['1', '2']], []);
        useDatasetStore.getState().initializePolicies(2);
        render(<AnonymityPanel />);
        const button = screen.getByRole('button', { name: 'Measure' });
        expect(button).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent(/Mark at least one column as Quasi-identifier/);
        expect(button).toHaveAccessibleDescription(/Mark at least one column as Quasi-identifier/);
    });

    it('is enabled, with no hint, once a quasi-identifier is marked', () => {
        render(<AnonymityPanel />);
        expect(screen.getByRole('button', { name: 'Measure' })).toBeEnabled();
        expect(screen.queryByText(/Measure is off/)).not.toBeInTheDocument();
    });
});

describe('AnonymityPanel', () => {
    it('measures the quasi-identifier columns and shows the core results', async () => {
        render(<AnonymityPanel />);
        expect(screen.getByText(/Quasi-identifiers: dob, city/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Measure' }));

        await waitFor(() => expect(screen.getByLabelText('Anonymity result')).toBeInTheDocument());
        expect(measureMock.mock.calls[0][5]).toEqual([2, 3]);
        expect(measureMock.mock.calls[0][6]).toBe(5);
        const result = screen.getByLabelText('Anonymity result');
        expect(result).toHaveTextContent('Smallest group1');
        expect(result).toHaveTextContent('Rows below k=56');
        expect(result).not.toHaveTextContent('undefined');
        expect(result).toHaveTextContent(/city \(0 rows below k without it\), dob \(4 rows/);
        expect(result).toHaveTextContent(RESULT.claim);
        expect(result).toHaveTextContent(/replace the quasi-identifier cells of 6 rows with \*/);
    });

    it('marks the result stale when a setting changes', async () => {
        render(<AnonymityPanel />);
        fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
        await waitFor(() => screen.getByLabelText('Anonymity result'));
        fireEvent.change(screen.getByLabelText('Target k'), { target: { value: '8' } });
        expect(screen.queryByLabelText('Anonymity result')).not.toBeInTheDocument();
        expect(screen.getByText(/measure again/)).toBeInTheDocument();
        expect(useDatasetStore.getState().k).toBe(8);
    });

    it('cannot measure without a quasi-identifier', () => {
        useDatasetStore.setState({ roles: { 0: 'identifier', 1: 'identifier', 2: 'other', 3: 'other' } });
        render(<AnonymityPanel />);
        expect(screen.getByRole('button', { name: 'Measure' })).toBeDisabled();
    });

    it('streamed files: unavailable, measure disabled, release blocked', () => {
        useDatasetStore.setState({ anonymousRelease: true });
        render(<AnonymityPanel streamed />);
        expect(screen.getByRole('button', { name: 'Measure' })).toBeDisabled();
        expect(screen.getAllByRole('alert')[0]).toHaveTextContent(/streamed/);
        expect(screen.getByLabelText('Anonymous release blockers')).toHaveTextContent(/streamed/);
    });

    it('shows no blockers until the switch is on, then names the offending columns', () => {
        useDatasetStore.getState().setPolicy(1, 'hash');
        render(<AnonymityPanel />);
        expect(screen.queryByLabelText('Anonymous release blockers')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('switch', { name: 'Anonymous release' }));
        const blockers = screen.getByLabelText('Anonymous release blockers');
        expect(blockers).toHaveTextContent('"email" (Hash)');
        expect(blockers).toHaveTextContent('Direct identifier columns must be redacted: "id" (Keep)');
    });

    it('is ready when policies comply', () => {
        useDatasetStore.getState().setPolicy(0, 'redact');
        useDatasetStore.getState().setPolicy(1, 'redact');
        useDatasetStore.getState().setAnonymousRelease(true);
        render(<AnonymityPanel />);
        expect(screen.queryByLabelText('Anonymous release blockers')).not.toBeInTheDocument();
        expect(screen.getByText(/Ready:/)).toBeInTheDocument();
    });

    it('keeps the honest limits in view', () => {
        render(<AnonymityPanel />);
        expect(screen.getByText(/linkage with other datasets, free-text columns or small files/)).toBeInTheDocument();
    });
});

describe('AnonymityPanel k field', () => {
    it('lets "10" be typed without clamping each keystroke, and clamps on blur', () => {
        render(<AnonymityPanel />);
        const input = screen.getByLabelText('Target k') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.change(input, { target: { value: '1' } });
        expect(input.value).toBe('1');
        fireEvent.change(input, { target: { value: '10' } });
        expect(input.value).toBe('10');
        expect(useDatasetStore.getState().k).toBe(10);
        fireEvent.change(input, { target: { value: '999' } });
        fireEvent.blur(input);
        expect(useDatasetStore.getState().k).toBe(50);
        expect(input.value).toBe('50');
    });
});
