import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CertificateBody } from './CertificateBody';
import type { Certificate } from '../../lib/crypto/certificate';

const HASH = 'a'.repeat(32) + 'b'.repeat(32);

const makeCert = (operations: string[]): Certificate => ({
    version: '1.0',
    id: 'c1',
    createdAt: 1,
    fileInfo: { filename: 'f.csv', fileSize: 10, fileHash: HASH, totalRows: 2, totalColumns: operations.length },
    summary: { byOperation: {}, totalTransformations: 0 },
    operations: operations.map((operation, i) => ({ columnName: `c${i}`, operation, rowsAffected: 2 })),
    signature: { algorithm: 'ECDSA', curve: 'P-256', hash: 'SHA-256', publicKey: 'pk', signature: 'sig' },
    processingStartedAt: 1,
    processingCompletedAt: 2,
});

describe('CertificateBody', () => {
    it('shows the full 64-character SHA-256, not a truncation', () => {
        render(<CertificateBody certificate={makeCert(['hash'])} />);
        expect(screen.getByTestId('file-hash')).toHaveTextContent(new RegExp(`^${HASH}$`));
        expect(screen.getByRole('button', { name: 'Copy SHA-256 hash' })).toBeInTheDocument();
    });

    it('appends the always-open explainer without a toggle', () => {
        render(<CertificateBody certificate={makeCert(['keep'])} />);
        expect(screen.getByRole('heading', { name: 'Why this is not a guarantee of anonymity' })).toBeInTheDocument();
        expect(screen.getByText(/No tool can certify a file as anonymous/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '(why?)' })).not.toBeInTheDocument();
    });

    it('carries the pseudonymisation notice', () => {
        render(<CertificateBody certificate={makeCert(['keep'])} />);
        expect(screen.getByRole('note')).toHaveTextContent(/pseudonymised, not anonymous/i);
    });

    it('renders an earlier kyber-aes run without any post-quantum claim', () => {
        const { container } = render(
            <CertificateBody certificate={makeCert(['hash', 'kyber-aes', 'legacy-kyber-aes'])} />
        );
        expect(screen.getByText('Kyber (deprecated)')).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/quantum/i);
    });

    it('states the measured k-anonymity and switches the notice only for a passed release', () => {
        const cert = {
            ...makeCert(['redact']),
            anonymity: {
                k: 5, mode: 'cells' as const, quasiIdentifiers: ['dob', 'city'],
                statement: 'k-anonymity k=5 measured, local suppression applied',
                claim: 'Measured: every combination of dob, city ...', minGroup: 6,
                rowsSuppressed: 3, cellsSuppressed: 6, rowsDropped: 0,
            },
        };
        render(<CertificateBody certificate={cert} />);
        expect(screen.getByRole('note')).toHaveAttribute('data-variant', 'k-anonymity');
        expect(screen.getByText('Anonymity Check').parentElement).toHaveTextContent(
            'k-anonymity k=5 measured, local suppression applied'
        );
        expect(screen.getByRole('note')).not.toHaveTextContent(/pseudonymised, not anonymous/i);
    });

    it('has no anonymity section without a passed release', () => {
        render(<CertificateBody certificate={makeCert(['keep'])} />);
        expect(screen.queryByText('Anonymity Check')).not.toBeInTheDocument();
    });
});
