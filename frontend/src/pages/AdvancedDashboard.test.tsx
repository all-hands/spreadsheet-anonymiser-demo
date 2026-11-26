import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const { createWorkerMock } = vi.hoisted(() => ({ createWorkerMock: vi.fn() }));
vi.mock('../lib/worker-client', () => ({ createWorker: createWorkerMock }));

import AdvancedDashboard from './AdvancedDashboard';
import { useDatasetStore } from '../store/datasetStore';

beforeEach(() => {
    useDatasetStore.getState().clearData();
    useDatasetStore.getState().initializePolicies(2);
});

describe('AdvancedDashboard notices', () => {
    it('always shows the pseudonymisation notice near the download action', () => {
        render(<AdvancedDashboard />);
        expect(screen.getByRole('note')).toHaveTextContent(/pseudonymised, not anonymous/i);
        expect(screen.getByRole('button', { name: /process & download/i })).toBeInTheDocument();
    });

    it('makes no post-quantum claim', () => {
        const { container } = render(<AdvancedDashboard />);
        act(() => useDatasetStore.getState().setPolicy(0, 'encrypt'));
        act(() => useDatasetStore.getState().setPolicy(1, 'legacy-kyber-aes'));
        expect(container.textContent).not.toMatch(/quantum/i);
    });
});
