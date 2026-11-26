import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

const { createWorkerMock } = vi.hoisted(() => ({ createWorkerMock: vi.fn() }));
vi.mock('../lib/worker-client', () => ({ createWorker: createWorkerMock }));

import AdvancedDashboard from './AdvancedDashboard';
import PreviewPage from './PreviewPage';
import { useDatasetStore } from '../store/datasetStore';
import { useAdvancedSessionStore } from '../store/advancedSessionStore';
import { installArtifactMocks, makeFile, PARSE } from '../test/pipeline-fakes';
import type { MeasureResult } from '../types/anonymity';

const MEASURE: MeasureResult = {
    report: { k: 5, rows: 2, groups: 1, min_group: 2, rows_below_k: 2, satisfied: false, per_column: [] },
    claim: 'Not k-anonymous at k=5',
};

beforeEach(() => {
    installArtifactMocks();
    createWorkerMock.mockReset();
    createWorkerMock.mockReturnValue({
        parseFile: vi.fn(async () => PARSE),
        measureAnonymity: vi.fn(async () => MEASURE),
    });
    useAdvancedSessionStore.getState().clearSession();
});

const app = () => (
    <MemoryRouter initialEntries={['/advanced']}>
        <Link to="/advanced/preview">to-preview</Link>
        <Link to="/advanced">to-dashboard</Link>
        <Routes>
            <Route path="/advanced" element={<AdvancedDashboard />} />
            <Route path="/advanced/preview" element={<PreviewPage />} />
        </Routes>
    </MemoryRouter>
);

const loadFile = async (name = 'people.csv') => {
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [makeFile(name)] } });
    await screen.findByText('Loaded 2 rows.');
};

describe('Advanced session survives route changes', () => {
    it('keeps the file, parse, status and policy grid after visiting Preview and coming back', async () => {
        render(app());
        await loadFile();
        expect(screen.getByText('people.csv')).toBeInTheDocument();

        fireEvent.click(screen.getByText('to-preview'));
        expect(screen.queryByText('Loaded 2 rows.')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('to-dashboard'));

        expect(screen.getByText('people.csv')).toBeInTheDocument();
        expect(screen.getByText('Loaded 2 rows.')).toBeInTheDocument();
        expect(screen.getAllByText('email').length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: /process & download/i })).toBeEnabled();
    });

    it('keeps the last measurement and the anonymity settings', async () => {
        render(app());
        await loadFile();
        await markQuasi();
        fireEvent.change(screen.getByLabelText('Target k'), { target: { value: '7' } });
        fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
        await screen.findByLabelText('Anonymity result');

        fireEvent.click(screen.getByText('to-preview'));
        fireEvent.click(screen.getByText('to-dashboard'));

        expect(screen.getByLabelText('Target k')).toHaveValue(7);
        expect(screen.getByLabelText('Anonymity result')).toBeInTheDocument();
    });

    it('does not revoke export links on unmount, and revokes them on a new file and on clear', async () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL');
        const { unmount } = render(app());
        await loadFile();
        useAdvancedSessionStore.getState().replaceArtifacts([{ url: 'blob:one', name: 'a.csv' }]);
        revoke.mockClear();
        unmount();
        expect(revoke).not.toHaveBeenCalled();
        expect(useAdvancedSessionStore.getState().artifacts).toHaveLength(1);

        render(app());
        await loadFile('second.csv');
        expect(revoke).toHaveBeenCalledWith('blob:one');
        const s = useAdvancedSessionStore.getState();
        expect(s.artifacts).toEqual([]);
        expect(s.measurement).toBeNull();
        expect(s.file?.name).toBe('second.csv');

        useAdvancedSessionStore.getState().replaceArtifacts([{ url: 'blob:two', name: 'b.csv' }]);
        useAdvancedSessionStore.getState().clearSession();
        expect(revoke).toHaveBeenCalledWith('blob:two');
        expect(useAdvancedSessionStore.getState().file).toBeNull();
        expect(useAdvancedSessionStore.getState().parse).toBeNull();
        expect(useDatasetStore.getState().headers).toEqual([]);
    });

    it('the Clear file / start over button revokes links and resets everything, without a prompt', async () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL');
        const confirm = vi.spyOn(window, 'confirm');
        render(app());
        const button = screen.getByRole('button', { name: /clear file \/ start over/i });
        expect(button).toBeDisabled();
        await loadFile();
        useAdvancedSessionStore.getState().replaceArtifacts([{ url: 'blob:keep', name: 'a.csv' }]);
        useDatasetStore.getState().toggleRowExclusion(1);
        expect(button).toBeEnabled();

        fireEvent.click(button);

        expect(confirm).not.toHaveBeenCalled();
        expect(revoke).toHaveBeenCalledWith('blob:keep');
        const st = useAdvancedSessionStore.getState();
        expect(st.file).toBeNull();
        expect(st.parse).toBeNull();
        expect(st.artifacts).toEqual([]);
        expect(useDatasetStore.getState().headers).toEqual([]);
        expect(useDatasetStore.getState().excludedRows.size).toBe(0);
        expect(screen.getByText('No file selected')).toBeInTheDocument();
        expect(button).toBeDisabled();
    });

    it('a new file resets roles, exclusions and policies', async () => {
        render(app());
        await loadFile();
        useDatasetStore.getState().toggleRowExclusion(0);
        useDatasetStore.getState().setPolicy(0, 'hash');
        await loadFile('again.csv');
        await waitFor(() => expect(useDatasetStore.getState().excludedRows.size).toBe(0));
        expect(useDatasetStore.getState().policies[0]?.type).not.toBe('hash');
    });
});

const markQuasi = async () => {
    await act(async () => useDatasetStore.getState().setRole(2, 'quasi-identifier'));
};
