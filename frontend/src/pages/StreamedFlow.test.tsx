import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, render, renderHook, screen, fireEvent } from '@testing-library/react';
import SimpleMode from './SimpleMode';
import RowExclusionPanel from '../components/dashboard/RowExclusionPanel';
import RunProgress from '../components/RunProgress';
import { useRunProgress } from '../hooks/useRunProgress';
import { installArtifactMocks, makeFile, PARSE } from '../test/pipeline-fakes';
import { useAuditStore } from '../store/auditStore';
import { STREAM_THRESHOLD_BYTES } from '../lib/constants';

const { createWorkerMock } = vi.hoisted(() => ({ createWorkerMock: vi.fn() }));
vi.mock('../lib/worker-client', () => ({ createWorker: createWorkerMock }));

beforeEach(() => {
    installArtifactMocks();
    createWorkerMock.mockReset();
    useAuditStore.setState({ currentLog: null });
});

const streamingWorker = (stream: ReturnType<typeof vi.fn>) => ({
    parseFile: vi.fn(async () => ({ ...PARSE, fileHash: '', streamed: true })),
    streamAnonymize: stream,
    cancelStream: vi.fn(async () => {}),
    anonymizeData: vi.fn(),
    generateFile: vi.fn(),
    decryptData: vi.fn(),
});

const pickBig = (name: string) => {
    const input = document.querySelector('input[type="file"]')!;
    const file = makeFile(name);
    Object.defineProperty(file, 'size', { value: STREAM_THRESHOLD_BYTES * 20 });
    fireEvent.change(input, { target: { files: [file] } });
};

describe('Simple mode on a streamed (large) file', () => {
    it('accepts a file far above the old 100 MiB cap, streams it and shows progress then Done', async () => {
        let finish!: () => void;
        const stream = vi.fn(
            (_f, _p, _o, _h, onProgress) =>
                new Promise((resolve) => {
                    onProgress({ bytes: 50, total: 100, rows: 1234 });
                    finish = () =>
                        resolve({ counts: { 1: 5 }, totalRows: 5, fileHash: 'h', blob: new Blob(['x']) });
                })
        );
        const worker = streamingWorker(stream);
        createWorkerMock.mockReturnValue(worker);
        render(<MemoryRouter><SimpleMode /></MemoryRouter>);

        pickBig('huge.csv');
        expect(await screen.findByText('joined')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Anonymise & download' }));

        expect(await screen.findByText(/50 B of 100 B \(50%\)/)).toBeInTheDocument();
        expect(screen.getByText(/1,234 rows/)).toBeInTheDocument();
        await act(async () => finish());
        expect(await screen.findByText('Done. Downloaded the data file and its audit log.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
        expect(worker.anonymizeData).not.toHaveBeenCalled();
        expect(useAuditStore.getState().currentLog?.totalRows).toBe(5);
    });

    it('Cancel asks the worker to stop and the page reports Cancelled, not an error', async () => {
        let release!: (e: Error) => void;
        const stream = vi.fn(
            (_f, _p, _o, _h, onProgress) =>
                new Promise((_, reject) => {
                    onProgress({ bytes: 1, total: 10, rows: 1 });
                    release = reject;
                })
        );
        const worker = streamingWorker(stream);
        createWorkerMock.mockReturnValue(worker);
        render(<MemoryRouter><SimpleMode /></MemoryRouter>);
        pickBig('huge.tsv');
        await screen.findByText('joined');
        fireEvent.click(screen.getByRole('button', { name: 'Anonymise & download' }));

        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
        expect(worker.cancelStream).toHaveBeenCalledTimes(1);
        await act(async () => release(new Error('Cancelled.')));

        expect(await screen.findByText('Cancelled.')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(useAuditStore.getState().currentLog?.status).toBe('failed');
    });
});

describe('RunProgress / useRunProgress', () => {
    it('renders nothing without progress and a percentage with it', () => {
        const { container, rerender } = render(<RunProgress progress={null} onCancel={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
        rerender(<RunProgress progress={{ bytes: 1024, total: 4096, rows: 9 }} onCancel={vi.fn()} />);
        expect(screen.getByText(/1 KB of 4 KB \(25%\)/)).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: 'Processing progress' })).toHaveAttribute('value', '25');
    });

    it('keeps progress state and routes cancel to the worker', () => {
        const worker = { cancelStream: vi.fn(async () => {}) };
        createWorkerMock.mockReturnValue(worker);
        const { result } = renderHook(() => useRunProgress());
        act(() => result.current.onProgress({ bytes: 2, total: 4, rows: 1 }));
        expect(result.current.progress?.bytes).toBe(2);
        act(() => result.current.cancel());
        expect(worker.cancelStream).toHaveBeenCalled();
        act(() => result.current.reset());
        expect(result.current.progress).toBeNull();
    });
});

describe('Advanced row exclusion on a streamed file', () => {
    it('shows a clear message instead of the (preview-only) row list', () => {
        render(<RowExclusionPanel rows={PARSE.data} streamed />);
        expect(screen.getByRole('note')).toHaveTextContent(/unavailable for large files/i);
        expect(screen.getByRole('note')).toHaveTextContent(/every row is exported/i);
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });
});
