import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { anonymizeData } = vi.hoisted(() => ({ anonymizeData: vi.fn() }));
vi.mock('../../lib/worker-client', () => ({ createWorker: () => ({ anonymizeData }) }));

import PolicyGrid from './PolicyGrid';
import { useDatasetStore } from '../../store/datasetStore';
import { useAdvancedSessionStore } from '../../store/advancedSessionStore';

const HEADERS = ['name'];
const ROWS = [['Alice'], ['Bob']];
const HEADERS2 = ['name', 'email'];
const ROWS2 = [['Alice', 'a@x.org'], ['Bob', 'b@x.org']];

const Grid2 = () => {
    const policies = useDatasetStore((s) => s.policies);
    return <PolicyGrid headers={HEADERS2} rows={ROWS2} policies={policies} />;
};

const Grid = () => {
    const policies = useDatasetStore((s) => s.policies);
    return <PolicyGrid headers={HEADERS} rows={ROWS} policies={policies} />;
};

describe('PolicyGrid live preview', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        anonymizeData.mockReset();
        anonymizeData.mockImplementation(async (rows: string[][], _h, _m, pol: Record<number, { type: string }>) => ({
            data: rows.map((r) => [`<${pol[0].type}>`, ...r.slice(1)]),
        }));
        useDatasetStore.getState().clearData();
        useAdvancedSessionStore.getState().beginKeyChange('off');
    });
    afterEach(() => vi.useRealTimers());

    it('shows originals for keep and does not call the worker', () => {
        render(<Grid />);
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(anonymizeData).not.toHaveBeenCalled();
    });

    it('updates cells when the selection changes, debounced to the last value', async () => {
        render(<Grid />);
        const select = screen.getByLabelText('Policy for "name"');
        fireEvent.change(select, { target: { value: 'redact' } });
        fireEvent.change(select, { target: { value: 'hash' } });
        expect(anonymizeData).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });
        expect(anonymizeData).toHaveBeenCalledTimes(1);
        expect(screen.getAllByText('<hash>')).toHaveLength(2);
        expect(screen.queryByText('Alice')).toBeNull();
    });

    it('shows an error rather than hiding a failed preview', async () => {
        anonymizeData.mockRejectedValue(new Error('boom'));
        render(<Grid />);
        fireEvent.change(screen.getByLabelText('Policy for "name"'), { target: { value: 'hash' } });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });
        expect(screen.getByTestId('grid-preview-status')).toHaveTextContent('Preview failed: boom');
    });

    it('says why a Year column of non-dates is redacted', async () => {
        anonymizeData.mockImplementation(async (rows: string[][]) => ({ data: rows.map(() => ['[REDACTED]']) }));
        render(<Grid />);
        fireEvent.change(screen.getByLabelText('Policy for "name"'), { target: { value: 'year' } });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });
        expect(screen.getByText('Year needs dates; these cells are redacted.')).toBeInTheDocument();
    });

    it('re-runs the Encrypt preview once the keyed session is enabled', async () => {
        render(<Grid />);
        fireEvent.change(screen.getByLabelText('Policy for "name"'), { target: { value: 'encrypt' } });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });
        expect(screen.getAllByText('(needs passphrase)')).toHaveLength(2);
        await act(async () => {
            useAdvancedSessionStore.getState().setKey(new Uint8Array(32), 'active');
            await vi.advanceTimersByTimeAsync(300);
        });
        expect(anonymizeData).toHaveBeenCalledTimes(2);
        expect(screen.getAllByText('<encrypt>')).toHaveLength(2);
    });

    it('keeps the other columns transformed when Encrypt is picked without a key', async () => {
        anonymizeData.mockImplementation(async (rows: string[][], _h, _m, pol: Record<number, { type: string }>) => {
            if (Object.values(pol).some((p) => p.type === 'encrypt')) throw new Error('needs key');
            return { data: rows.map((r) => r.map((c, i) => (pol[i]?.type === 'mask' ? '***' : c))) };
        });
        render(<Grid2 />);
        fireEvent.change(screen.getByLabelText('Policy for "name"'), { target: { value: 'mask' } });
        fireEvent.change(screen.getByLabelText('Policy for "email"'), { target: { value: 'encrypt' } });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });
        expect(screen.getAllByText('***')).toHaveLength(2);
        expect(screen.queryByText('Alice')).toBeNull();
        expect(screen.queryByText('a@x.org')).toBeNull();
        expect(screen.getAllByText('(needs passphrase)')).toHaveLength(2);
        expect(screen.getByTestId('grid-preview-status')).toHaveTextContent('Keyed hashing');
    });
});
