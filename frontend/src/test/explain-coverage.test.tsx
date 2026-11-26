import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const { createWorkerMock, certMock } = vi.hoisted(() => ({ createWorkerMock: vi.fn(), certMock: vi.fn() }));
vi.mock('../lib/worker-client', () => ({ createWorker: createWorkerMock }));
vi.mock('../hooks/useCertificate', () => ({ useCertificate: certMock }));

import SimpleLayout from '../layouts/SimpleLayout';
import AdvancedLayout from '../layouts/AdvancedLayout';
import SimpleMode from '../pages/SimpleMode';
import AdvancedDashboard from '../pages/AdvancedDashboard';
import PreviewPage from '../pages/PreviewPage';
import CertificatePage from '../pages/CertificatePage';
import PseudonymisationNotice from '../components/PseudonymisationNotice';
import ErrorPanel from '../components/ErrorPanel';
import { ThemeProvider } from '../themes/ThemeProvider';
import { useDatasetStore } from '../store/datasetStore';
import { useAdvancedSessionStore } from '../store/advancedSessionStore';
import { useAuditStore } from '../store/auditStore';
import { useExplainStore } from '../store/explainStore';
import { installArtifactMocks, makeFile, PARSE } from './pipeline-fakes';
import type { MeasureResult } from '../types/anonymity';
import type { Certificate } from '../lib/crypto/certificate';

const INTERACTIVE =
    'button, a[href], input, select, textarea, summary, [role="button"], [role="tab"], [role="switch"], [role="link"], h1, h2, h3, h4, h5, h6, [tabindex]:not([tabindex="-1"])';

const hidden = (el: Element) => !!el.closest('[aria-hidden="true"], [hidden]') || (el as HTMLInputElement).type === 'hidden';
const unexplained = (root: ParentNode) =>
    Array.from(root.querySelectorAll(INTERACTIVE))
        .filter((el) => !hidden(el))
        .filter((el) => !el.closest('[data-explain]'))
        .map((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`);

const MEASURE: MeasureResult = {
    report: {
        k: 5, rows: 2, groups: 1, min_group: 2, rows_below_k: 2, satisfied: false,
        per_column: [{ column: 0, rows_below_k_without: 0, min_group_without: 2 }],
    },
    claim: 'Not k-anonymous at k=5',
};

beforeEach(() => {
    installArtifactMocks();
    localStorage.clear();
    useExplainStore.setState({ enabled: true });
    createWorkerMock.mockReset();
    createWorkerMock.mockReturnValue({
        parseFile: vi.fn(async () => PARSE),
        measureAnonymity: vi.fn(async () => MEASURE),
        atRiskRows: vi.fn(async () => [{ row: 0, values: ['2024-01-01'] }, { row: 1, values: ['2024-02-02'] }]),
        anonymizeData: vi.fn(async () => ({ data: PARSE.data })),
    });
    useAdvancedSessionStore.getState().clearSession();
    useAuditStore.setState({ currentLog: null });
});

const app = (path: string) => (
    <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/" element={<SimpleLayout />}>
                    <Route path="simple" element={<SimpleMode />} />
                </Route>
                <Route path="/advanced" element={<AdvancedLayout />}>
                    <Route index element={<AdvancedDashboard />} />
                    <Route path="preview" element={<PreviewPage />} />
                    <Route path="certificate" element={<CertificatePage />} />
                </Route>
            </Routes>
        </MemoryRouter>
    </ThemeProvider>
);

const pick = async (name = 'people.csv') => {
    const input = document.querySelector('input[type="file"]')!;
    await act(async () => {
        fireEvent.change(input, { target: { files: [makeFile(name)] } });
    });
};

const CERT: Certificate = {
    version: '1.0',
    id: 'c1',
    createdAt: 1,
    fileInfo: { filename: 'f.csv', fileSize: 10, fileHash: 'a'.repeat(64), totalRows: 2, totalColumns: 1 },
    summary: { byOperation: {}, totalTransformations: 0 },
    operations: [{ columnName: 'c0', operation: 'hash', rowsAffected: 2 }],
    signature: { algorithm: 'ECDSA', curve: 'P-256', hash: 'SHA-256', publicKey: 'pk', signature: 'sig' },
    processingStartedAt: 1,
    processingCompletedAt: 2,
};

const certState = (over: Record<string, unknown> = {}) => ({
    currentLog: { status: 'completed' },
    certificate: CERT,
    isVerified: true,
    isGenerating: false,
    error: null,
    certArtifact: { url: 'blob:c', name: 'certificate.json' },
    generateCert: vi.fn(),
    handleDownload: vi.fn(),
    ...over,
});

describe('the check itself', () => {
    it('fails on a bare control', () => {
        const { container } = render(<div><button>bare</button><h2>head</h2></div>);
        expect(unexplained(container)).toEqual(['button "bare"', 'h2 "head"']);
    });
});

describe('every control and heading is explained', () => {
    it('Simple mode: upload screen', () => {
        render(app('/simple'));
        expect(screen.getByRole('switch', { name: /show explanations/i })).toBeInTheDocument();
        expect(unexplained(document.body)).toEqual([]);
    });

    it('Simple mode: column chooser with every note', async () => {
        render(app('/simple'));
        await pick();
        await screen.findByRole('button', { name: 'Anonymise & download' });
        const selects = screen.getAllByRole('combobox');
        fireEvent.change(selects[0], { target: { value: 'hash' } });
        fireEvent.change(selects[1], { target: { value: 'hash-run' } });
        fireEvent.change(selects[2], { target: { value: 'age-band' } });
        expect(unexplained(document.body)).toEqual([]);
    });

    it('Advanced dashboard: empty, loaded, measured, with roles, params, undo, audit log and downloads', async () => {
        render(app('/advanced'));
        expect(unexplained(document.body)).toEqual([]);

        await pick();
        await screen.findByText('Loaded 2 rows.');
        await act(async () => useDatasetStore.getState().setRole(2, 'quasi-identifier'));
        act(() => useDatasetStore.getState().setPolicy(0, 'hash'));
        act(() => useDatasetStore.getState().setPolicy(1, 'age-band'));
        act(() => useDatasetStore.getState().setPolicy(2, 'bucket'));
        fireEvent.click(screen.getByRole('button', { name: 'Reset all to Keep' }));
        act(() => useDatasetStore.getState().setPolicy(0, 'hash'));
        act(() => useDatasetStore.getState().setPolicy(1, 'age-band'));
        fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
        await screen.findByLabelText('Anonymity result');
        fireEvent.click(await screen.findByRole('button', { name: 'Choose rows to ignore' }));
        await screen.findByLabelText('At-risk rows');
        fireEvent.click(screen.getByRole('switch', { name: 'Anonymous release' }));
        act(() => {
            const a = useAuditStore.getState();
            a.startNewLog('people.csv', 10, 2, 3);
            a.addEntry({ columnIndex: 0, columnName: 'name', operation: 'hash', rowsAffected: 2 });
            a.completeLog();
            useAdvancedSessionStore.setState({
                artifacts: [{ url: 'blob:a', name: 'people.anonymised.csv' }],
                policyArtifacts: [{ url: 'blob:p', name: 'policy.json' }],
            });
        });
        expect(screen.getByRole('heading', { name: 'Audit Log' })).toBeInTheDocument();
        expect(document.querySelectorAll('[data-explain]').length).toBeGreaterThan(60);
        expect(unexplained(document.body)).toEqual([]);
    });

    it('Advanced dashboard: a streamed-size note, no quasi-identifier and a key session', async () => {
        render(app('/advanced'));
        await pick();
        await screen.findByText('Loaded 2 rows.');
        fireEvent.change(screen.getByLabelText('Passphrase for keyed hashing'), { target: { value: 'pw' } });
        expect(unexplained(document.body)).toEqual([]);
    });

    it('Preview', async () => {
        render(app('/advanced'));
        await pick();
        await screen.findByText('Loaded 2 rows.');
        act(() => useDatasetStore.getState().setPolicy(0, 'redact'));
        fireEvent.click(screen.getByRole('link', { name: /preview/i }));
        await screen.findByRole('heading', { name: 'Side-by-Side Preview' });
        expect(unexplained(document.body)).toEqual([]);
    });

    it('Preview and Certificate: the empty states', () => {
        useDatasetStore.getState().clearData();
        certMock.mockReturnValue(certState({ currentLog: null, certificate: null, certArtifact: null }));
        render(app('/advanced/certificate'));
        expect(unexplained(document.body)).toEqual([]);
    });

    it.each([
        ['waiting, can generate', { certificate: null, certArtifact: null }],
        ['failed, can retry', { certificate: null, error: 'x', certArtifact: null }],
    ])('Certificate: %s', (_n, over) => {
        certMock.mockReturnValue(certState(over));
        render(app('/advanced/certificate'));
        expect(unexplained(document.body)).toEqual([]);
    });

    it('Certificate: the signed view, both notice variants', () => {
        certMock.mockReturnValue(certState());
        render(app('/advanced/certificate'));
        expect(screen.getByRole('heading', { name: 'Audit Certificate' })).toBeInTheDocument();
        expect(unexplained(document.body)).toEqual([]);
        expect(screen.getByRole('heading', { name: 'Why this is not a guarantee of anonymity' })).toHaveAttribute('data-explain');
        cleanup();
        certMock.mockReturnValue(
            certState({ certificate: { ...CERT, anonymity: { k: 5, quasiIdentifiers: ['c0'], minGroup: 5, rowsSuppressed: 0, statement: 'k=5', claim: 'c' } } })
        );
        render(app('/advanced/certificate'));
        expect(screen.getByText('Anonymity Check')).toHaveAttribute('data-explain');
        expect(unexplained(document.body)).toEqual([]);
    });

    it.each(['pseudonymised', 'k-anonymity'] as const)('the notice with its panel open (%s)', (variant) => {
        const anonymity =
            variant === 'k-anonymity'
                ? ({ k: 5, quasiIdentifiers: ['c0'], minGroup: 5, rowsSuppressed: 0, statement: 'k=5', claim: 'c' } as never)
                : null;
        const { container } = render(<PseudonymisationNotice anonymity={anonymity} />);
        const why = screen.getByRole('button', { name: /why\?/ });
        expect(why).toHaveAttribute('data-explain', `notice.why.${variant}`);
        fireEvent.click(why);
        expect(why).toHaveAttribute('aria-expanded', 'true');
        expect(container.querySelector('[role="region"]:not([hidden])')).not.toBeNull();
        expect(unexplained(container)).toEqual([]);
        fireEvent.focus(why);
        expect(screen.getByRole('tooltip').className).toContain('print:hidden');
    });

    it('Error screen', () => {
        render(<ErrorPanel onRetry={() => {}} />);
        expect(unexplained(document.body)).toEqual([]);
    });
});

describe('with the setting off nothing is marked', () => {
    it('adds no data-explain and no aria-describedby of ours on any page', async () => {
        useExplainStore.setState({ enabled: false });
        render(app('/advanced'));
        await pick();
        await screen.findByText('Loaded 2 rows.');
        expect(document.querySelectorAll('[data-explain]')).toHaveLength(0);
        expect(screen.queryByRole('tooltip')).toBeNull();
        for (const el of Array.from(document.querySelectorAll('[aria-describedby]'))) {
            expect(el.getAttribute('aria-describedby')).toMatch(/blocked|hint/);
        }
    });
});
