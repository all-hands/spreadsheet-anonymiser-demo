import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DashboardCards from './DashboardCards';

afterEach(() => vi.unstubAllGlobals());

const baseProps = () => ({
    file: null,
    onFileSelect: vi.fn(),
    status: '',
    artifacts: [],
    policyArtifacts: [],
    passphrase: '',
    setPassphrase: () => {},
    keyStatus: 'off' as const,
    onEnableKey: () => {},
    onDisableKey: () => {},
    isProcessing: false,
    onProcess: () => {},
    dataset: '',
    setDataset: () => {},
    tokenEncoding: 'hex' as const,
    setTokenEncoding: () => {},
    hasHeaders: false,
    onExportPolicy: () => {},
    onImportPolicy: () => {},
    onDecrypt: () => {},
    onClear: () => {},
});

describe('DashboardCards Source File card', () => {
    it('loads a demo file through the same handler as the file input', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('a,b\n1,2\n', { status: 200 })));
        const props = baseProps();
        render(<DashboardCards {...props} />);
        fireEvent.click(screen.getByRole('button', { name: /customers/i }));
        await waitFor(() => expect(props.onFileSelect).toHaveBeenCalledTimes(1));
        const event = props.onFileSelect.mock.calls[0][0] as { target: { files: File[] } };
        expect(event.target.files).toHaveLength(1);
        expect(event.target.files[0].name).toBe('customers.csv');
    });
});
