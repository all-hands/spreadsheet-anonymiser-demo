import { describe, it, expect } from 'vitest';
import {
    generateKeypair,
    exportPublicKey,
    signData,
    verifySignature,
    generateCertificate,
    verifyCertificate,
} from './certificate';
import type { AuditLog } from '../../types/audit';

describe('certificate crypto', () => {
    describe('generateKeypair', () => {
        it('generates a valid ECDSA P-256 keypair', async () => {
            const keypair = await generateKeypair();

            expect(keypair.privateKey).toBeDefined();
            expect(keypair.publicKey).toBeDefined();
            expect(keypair.privateKey.algorithm.name).toBe('ECDSA');
            expect(keypair.publicKey.algorithm.name).toBe('ECDSA');
        });
    });

    describe('exportPublicKey', () => {
        it('exports public key as base64 string', async () => {
            const keypair = await generateKeypair();
            const exported = await exportPublicKey(keypair.publicKey);

            expect(typeof exported).toBe('string');
            expect(exported.length).toBeGreaterThan(0);
            expect(exported).not.toContain('\n');
        });
    });

    describe('signData and verifySignature', () => {
        it('creates valid signature that can be verified', async () => {
            const keypair = await generateKeypair();
            const publicKeyBase64 = await exportPublicKey(keypair.publicKey);

            const data = 'test data to sign';
            const signature = await signData(data, keypair.privateKey);

            const isValid = await verifySignature(data, signature, publicKeyBase64);
            expect(isValid).toBe(true);
        });

        it('rejects tampered data', async () => {
            const keypair = await generateKeypair();
            const publicKeyBase64 = await exportPublicKey(keypair.publicKey);

            const data = 'original data';
            const signature = await signData(data, keypair.privateKey);

            const isValid = await verifySignature('tampered data', signature, publicKeyBase64);
            expect(isValid).toBe(false);
        });

        it('rejects invalid signature', async () => {
            const keypair = await generateKeypair();
            const publicKeyBase64 = await exportPublicKey(keypair.publicKey);

            const data = 'test data';
            const isValid = await verifySignature(data, 'invalidsignature', publicKeyBase64);
            expect(isValid).toBe(false);
        });
    });

    describe('generateCertificate', () => {
        const mockAuditLog: AuditLog = {
            id: 'test-log-id',
            createdAt: Date.now() - 1000,
            completedAt: Date.now(),
            filename: 'test.csv',
            fileSize: 1024,
            fileHash: 'abc123hash',
            totalRows: 100,
            totalColumns: 5,
            entries: [
                {
                    id: 'entry-1',
                    timestamp: Date.now(),
                    columnIndex: 0,
                    columnName: 'email',
                    operation: 'redact',
                    rowsAffected: 100,
                },
            ],
            status: 'completed',
        };

        it('generates a valid certificate', async () => {
            const certificate = await generateCertificate(mockAuditLog);

            expect(certificate.version).toBe('1.0');
            expect(certificate.id).toBe(mockAuditLog.id);
            expect(certificate.fileInfo.filename).toBe('test.csv');
            expect(certificate.fileInfo.fileHash).toBe('abc123hash');
            expect(certificate.operations).toHaveLength(1);
            expect(certificate.signature.algorithm).toBe('ECDSA');
        });

        it('records keyed-per-run hash as such, only when the entry says so', async () => {
            const certificate = await generateCertificate({
                ...mockAuditLog,
                entries: [
                    { ...mockAuditLog.entries[0], operation: 'hash', keying: 'run' },
                    { ...mockAuditLog.entries[0], id: 'entry-2', operation: 'hash' },
                ],
            });
            expect(certificate.operations[0]).toEqual({
                columnName: 'email',
                operation: 'hash',
                keying: 'run',
                rowsAffected: 100,
            });
            expect('keying' in certificate.operations[1]).toBe(false);
        });

        it('includes transformation summary', async () => {
            const certificate = await generateCertificate(mockAuditLog);

            expect(certificate.summary.byOperation['redact']).toBe(1);
            expect(certificate.summary.totalTransformations).toBe(100);
        });
    });

    describe('verifyCertificate', () => {
        const mockAuditLog: AuditLog = {
            id: 'verify-test-id',
            createdAt: Date.now() - 1000,
            completedAt: Date.now(),
            filename: 'verify.csv',
            fileSize: 2048,
            totalRows: 50,
            totalColumns: 3,
            entries: [],
            status: 'completed',
        };

        it('verifies a valid certificate', async () => {
            const certificate = await generateCertificate(mockAuditLog);
            const isValid = await verifyCertificate(certificate);

            expect(isValid).toBe(true);
        });

        it('rejects tampered certificate', async () => {
            const certificate = await generateCertificate(mockAuditLog);

            certificate.fileInfo.totalRows = 999;

            const isValid = await verifyCertificate(certificate);
            expect(isValid).toBe(false);
        });
    });
});
