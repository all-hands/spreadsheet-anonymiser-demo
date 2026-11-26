import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import SimpleMode from './SimpleMode';
import { makeFile, makeWorker, installArtifactMocks } from '../test/pipeline-fakes';
import { useAuditStore } from '../store/auditStore';
import { MAX_FILE_BYTES } from '../lib/constants';

const { createWorkerMock } = vi.hoisted(() => ({ createWorkerMock: vi.fn() }));

vi.mock('../lib/worker-client', () => ({
    createWorker: createWorkerMock,
}));

let clickMock: ReturnType<typeof installArtifactMocks>['clickMock'];

beforeEach(() => {
    ({ clickMock } = installArtifactMocks());
    createWorkerMock.mockReset();
    useAuditStore.setState({ currentLog: null });
});

const pickFile = (name: string) => {
    const input = document.querySelector('input[type="file"]');
    if (!input) throw new Error('file input not rendered');
    fireEvent.change(input, { target: { files: [makeFile(name)] } });
};

describe('SimpleMode', () => {
    it('parses, downloads nothing before the explicit action, then runs once with the seeded policies', async () => {
        const { worker, calls } = makeWorker([]);
        createWorkerMock.mockReturnValue(worker);

        render(<MemoryRouter><SimpleMode /></MemoryRouter>);

        pickFile('data.csv');
        expect(await screen.findByText('joined')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Anonymise & download' })).toBeInTheDocument();
        expect(clickMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Anonymise & download' }));

        expect(await screen.findByText('Done. Downloaded the data file and its audit log.')).toBeInTheDocument();
        expect(clickMock).toHaveBeenCalledTimes(1);

        expect(calls.anonymizePolicies).toEqual({
            0: { type: 'redact' },
            1: { type: 'redact' },
            2: { type: 'year' },
        });

        expect(screen.getByRole('link', { name: 'anonymized-data.csv' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'data_audit.json' })).toBeInTheDocument();
    });

    it('surfaces a parse failure as the status line and renders no chooser', async () => {
        const worker = {
            ...makeWorker([]).worker,
            parseFile: async () => {
                throw new Error('boom-parse');
            },
        };
        createWorkerMock.mockReturnValue(worker);

        render(<MemoryRouter><SimpleMode /></MemoryRouter>);
        pickFile('data.csv');

        expect(await screen.findByText('Error: boom-parse')).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Anonymise & download' })
        ).not.toBeInTheDocument();
        expect(clickMock).not.toHaveBeenCalled();
    });

    it('returns to the dropzone on "Choose a different file"', async () => {
        const { worker } = makeWorker([]);
        createWorkerMock.mockReturnValue(worker);

        render(<MemoryRouter><SimpleMode /></MemoryRouter>);
        pickFile('data.csv');
        await screen.findByText('joined');

        fireEvent.click(screen.getByRole('button', { name: 'Choose a different file' }));

        expect(screen.getByText('Drag & drop your data file')).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Anonymise & download' })
        ).not.toBeInTheDocument();
    });

    it('shows the pseudonymisation notice at the chooser step and keeps it after download', async () => {
        const { worker } = makeWorker([]);
        createWorkerMock.mockReturnValue(worker);

        render(<MemoryRouter><SimpleMode /></MemoryRouter>);
        expect(screen.queryByRole('note')).not.toBeInTheDocument();
        pickFile('data.csv');
        await screen.findByText('joined');
        expect(screen.getByRole('note')).toHaveTextContent(/pseudonymised, not anonymous/i);

        fireEvent.click(screen.getByRole('button', { name: 'Anonymise & download' }));
        await screen.findByText('Done. Downloaded the data file and its audit log.');
        expect(screen.getByRole('note')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /dismiss|close/i })).not.toBeInTheDocument();
    });

    it('refuses an oversize file with the limit and a CLI hint, without parsing', async () => {
        render(<MemoryRouter><SimpleMode /></MemoryRouter>);
        const input = document.querySelector('input[type="file"]')!;
        const big = makeFile('big.xlsx');
        Object.defineProperty(big, 'size', { value: MAX_FILE_BYTES + 1 });
        fireEvent.change(input, { target: { files: [big] } });

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/100 MB/);
        expect(alert).toHaveTextContent(/anonymiser-cli/);
        expect(createWorkerMock).not.toHaveBeenCalled();
    });

    it('refuses an unsupported format naming the supported formats', async () => {
        render(<MemoryRouter><SimpleMode /></MemoryRouter>);
        pickFile('data.json');
        expect(await screen.findByRole('alert')).toHaveTextContent(/only supports \.csv, \.tsv, \.jsonl, \.xlsx and \.ods/);
        expect(createWorkerMock).not.toHaveBeenCalled();
    });
});
