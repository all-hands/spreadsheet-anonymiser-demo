import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const { createWorkerMock } = vi.hoisted(() => ({ createWorkerMock: vi.fn() }));
vi.mock('../lib/worker-client', () => ({ createWorker: createWorkerMock }));

import AdvancedDashboard from './AdvancedDashboard';
import SimpleMode from './SimpleMode';
import { useDatasetStore } from '../store/datasetStore';
import { useAdvancedSessionStore } from '../store/advancedSessionStore';
import { useAuditStore } from '../store/auditStore';
import { installArtifactMocks, makeFile, PARSE } from '../test/pipeline-fakes';
import { KEYED_SESSION_REQUIRED } from '../types/policy';

const EMPTY = { ...PARSE, headers: [], data: [], metadata: [] };
const HEADER_ONLY = { ...PARSE, data: [] };

const statusLine = () => screen.getAllByRole('status').find((e) => e.className.includes('font-mono'))!;

let worker: Record<string, unknown>;

beforeEach(() => {
    installArtifactMocks();
    worker = {
        parseFile: vi.fn(async () => PARSE),
        startSession: vi.fn(async () => new Uint8Array(32)),
        endSession: vi.fn(async () => {}),
        anonymizeData: vi.fn(async (data: unknown) => ({ data, counts: {} })),
        generateFile: vi.fn(async () => new Blob(['x'])),
    };
    createWorkerMock.mockReset();
    createWorkerMock.mockImplementation(() => worker);
    useAdvancedSessionStore.getState().clearSession();
    useAdvancedSessionStore.getState().setKey(null, 'off');
    useAuditStore.getState().clearCurrentLog();
    useDatasetStore.getState().setDataset('');
});

const page = () => (
    <MemoryRouter>
        <AdvancedDashboard />
    </MemoryRouter>
);

const load = async (name = 'people.csv') => {
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [makeFile(name)] } });
    await waitFor(() => expect(useAdvancedSessionStore.getState().busy).toBe(false));
};

describe('Advanced: Encrypt needs the keyed session', () => {
    it('disables Process with the reason while Encrypt is chosen and no session is active', async () => {
        render(page());
        await load();
        await screen.findByText('Loaded 2 rows.');
        act(() => useDatasetStore.getState().setPolicy(0, 'encrypt'));
        expect(screen.getByRole('button', { name: /process & download/i })).toBeDisabled();
        expect(screen.getByText(KEYED_SESSION_REQUIRED)).toBeInTheDocument();
        act(() => useDatasetStore.getState().setPolicy(0, 'hash'));
        expect(screen.getByRole('button', { name: /process & download/i })).toBeEnabled();
        expect(screen.queryByText(KEYED_SESSION_REQUIRED)).not.toBeInTheDocument();
    });

    it('a failed run clears the previous run links and shows the error, not progress', async () => {
        render(page());
        await load();
        await screen.findByText('Loaded 2 rows.');
        useAdvancedSessionStore.getState().replaceArtifacts([{ url: 'blob:old', name: 'old.csv' }]);
        let late: ((m: string) => void) | undefined;
        worker.anonymizeData = vi.fn(async (_d: unknown, _h: unknown, _m: unknown, _p: unknown, onProgress: (m: string) => void) => {
            late = onProgress;
            throw new Error('wrong key');
        });
        act(() => useDatasetStore.getState().setPolicy(1, 'mask'));
        fireEvent.click(screen.getByRole('button', { name: /process & download/i }));
        await screen.findByText('Error: wrong key');
        late?.('Anonymising row 0/2');
        expect(statusLine()).toHaveTextContent('Error: wrong key');
        expect(useAdvancedSessionStore.getState().artifacts).toEqual([]);
    });
});

describe('Advanced: empty files, new file, start over', () => {
    it('refuses an empty and a header-only file with a clear message and no grid', async () => {
        render(page());
        for (const parse of [EMPTY, HEADER_ONLY]) {
            (worker.parseFile as ReturnType<typeof vi.fn>).mockResolvedValue(parse);
            await load('e.csv');
            await waitFor(() => expect(statusLine()).toHaveTextContent(/^Error: This file/));
            expect(useAdvancedSessionStore.getState().parse).toBeNull();
            expect(useAdvancedSessionStore.getState().busy).toBe(false);
            expect(screen.getByRole('button', { name: /process & download/i })).toBeDisabled();
        }
    });

    it('resets the audit log when a new file loads and on start over', async () => {
        render(page());
        const audit = useAuditStore.getState();
        audit.startNewLog('old.csv', 1, 2, 3);
        audit.completeLog();
        await load('new.csv');
        expect(useAuditStore.getState().currentLog).toBeNull();

        audit.startNewLog('again.csv', 1, 2, 3);
        fireEvent.click(screen.getByRole('button', { name: /clear file \/ start over/i }));
        expect(useAuditStore.getState().currentLog).toBeNull();
    });

    it('start over also ends the keyed session and clears the dataset namespace', async () => {
        render(page());
        await load();
        fireEvent.change(screen.getByLabelText('Passphrase for keyed hashing'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Derive session key from passphrase' }));
        await screen.findByText('Keyed session active');
        useDatasetStore.getState().setDataset('ds1');

        fireEvent.click(screen.getByRole('button', { name: /clear file \/ start over/i }));

        await waitFor(() => expect(screen.getByLabelText('Passphrase for keyed hashing')).toHaveValue(''));
        expect(useAdvancedSessionStore.getState().keyStatus).toBe('off');
        expect(useAdvancedSessionStore.getState().salt).toBeNull();
        expect(worker.endSession).toHaveBeenCalled();
        expect(useDatasetStore.getState().dataset).toBe('');
    });
});

describe('Advanced: policy import fails closed', () => {
    const importText = async (text: string) => {
        const input = screen.getByLabelText('Import policy.json');
        const f = new File([text], 'policy.json', { type: 'application/json' });
        Object.defineProperty(f, 'text', { value: async () => text });
        fireEvent.change(input, { target: { files: [f] } });
    };

    it('names an unsupported version, not "imported (0 columns)"', async () => {
        render(page());
        await load();
        await importText('{"version":99,"columns":[]}');
        await waitFor(() => expect(statusLine()).toHaveTextContent(/unsupported policy\.json version 99/));
        expect(statusLine()).not.toHaveTextContent(/imported/);
    });

    it('gives a friendly message for non-JSON, never the engine text', async () => {
        render(page());
        await load();
        await importText('nope');
        await waitFor(() => expect(statusLine()).toHaveTextContent(/not valid JSON/));
        expect(statusLine()).not.toHaveTextContent(/Unexpected token/);
    });
});

describe('Simple: empty files', () => {
    it('refuses an empty and a header-only file: no chooser, no stale green message', async () => {
        render(<SimpleMode />);
        for (const parse of [EMPTY, HEADER_ONLY]) {
            (worker.parseFile as ReturnType<typeof vi.fn>).mockResolvedValue(parse);
            fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [makeFile('e.csv')] } });
            const alert = await screen.findByRole('alert');
            expect(alert).toHaveTextContent(/^Error: This file/);
            expect(screen.queryByRole('button', { name: /anonymise/i })).not.toBeInTheDocument();
        }
    });

    it('clears the previous audit log when a new file is chosen', async () => {
        useAuditStore.getState().startNewLog('old.csv', 1, 2, 3);
        render(<SimpleMode />);
        fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [makeFile('n.csv')] } });
        await screen.findByText(/Choose anonymisation/);
        expect(useAuditStore.getState().currentLog).toBeNull();
    });
});

describe('Advanced: Start over during key derivation', () => {
    it('does not resurrect a keyed session revoked while Argon2id runs', async () => {
        let resolve!: (s: Uint8Array) => void;
        (worker.startSession as ReturnType<typeof vi.fn>).mockImplementation(
            () => new Promise<Uint8Array>((r) => (resolve = r))
        );
        render(page());
        fireEvent.change(screen.getByLabelText('Passphrase for keyed hashing'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Derive session key from passphrase' }));
        await waitFor(() => expect(useAdvancedSessionStore.getState().keyStatus).toBe('deriving'));
        useAdvancedSessionStore.getState().beginKeyChange('off');
        await act(async () => resolve(new Uint8Array(32).fill(7)));
        expect(useAdvancedSessionStore.getState().keyStatus).toBe('off');
        expect(useAdvancedSessionStore.getState().salt).toBeNull();
        expect(worker.endSession).toHaveBeenCalled();
    });
});
