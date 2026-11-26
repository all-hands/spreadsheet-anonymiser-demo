import type { AuditLog, AuditSummary } from '../../types/audit';
import type { AnonymityAudit } from '../../types/anonymity';
import { generateAuditSummary } from '../../types/audit';
import { downloadBlob } from '../download';
import type { Artifact } from '../download';

export interface Certificate {
    version: '1.0';
    id: string;
    createdAt: number;

    fileInfo: {
        filename: string;
        fileSize: number;
        fileHash: string;
        totalRows: number;
        totalColumns: number;
    };

    summary: AuditSummary;

    operations: Array<{
        columnName: string;
        operation: string;
        keying?: 'run';
        rowsAffected: number;
    }>;

    anonymity?: AnonymityAudit;

    signature: {
        algorithm: 'ECDSA';
        curve: 'P-256';
        hash: 'SHA-256';
        publicKey: string;
        signature: string;
    };

    processingStartedAt: number;
    processingCompletedAt: number;
}

export const generateKeypair = async (): Promise<CryptoKeyPair> => {
    return crypto.subtle.generateKey(
        {
            name: 'ECDSA',
            namedCurve: 'P-256',
        },
        true,
        ['sign', 'verify']
    );
};

export const exportPublicKey = async (publicKey: CryptoKey): Promise<string> => {
    const exported = await crypto.subtle.exportKey('spki', publicKey);
    return arrayBufferToBase64(exported);
};

export const signData = async (data: string, privateKey: CryptoKey): Promise<string> => {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);

    const signature = await crypto.subtle.sign(
        {
            name: 'ECDSA',
            hash: { name: 'SHA-256' },
        },
        privateKey,
        dataBuffer
    );

    return arrayBufferToBase64(signature);
};

export const verifySignature = async (
    data: string,
    signatureBase64: string,
    publicKeyBase64: string
): Promise<boolean> => {
    try {
        const publicKeyBuffer = base64ToArrayBuffer(publicKeyBase64);
        const publicKey = await crypto.subtle.importKey(
            'spki',
            publicKeyBuffer,
            {
                name: 'ECDSA',
                namedCurve: 'P-256',
            },
            false,
            ['verify']
        );

        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const signatureBuffer = base64ToArrayBuffer(signatureBase64);

        return crypto.subtle.verify(
            {
                name: 'ECDSA',
                hash: { name: 'SHA-256' },
            },
            publicKey,
            signatureBuffer,
            dataBuffer
        );
    } catch {
        return false;
    }
};

export const generateCertificate = async (auditLog: AuditLog): Promise<Certificate> => {
    const keypair = await generateKeypair();
    const publicKeyBase64 = await exportPublicKey(keypair.publicKey);

    const certData = {
        version: '1.0' as const,
        id: auditLog.id,
        createdAt: Date.now(),
        fileInfo: {
            filename: auditLog.filename,
            fileSize: auditLog.fileSize,
            fileHash: auditLog.fileHash || 'N/A',
            totalRows: auditLog.totalRows,
            totalColumns: auditLog.totalColumns,
        },
        summary: generateAuditSummary(auditLog),
        operations: auditLog.entries.map((entry) => ({
            columnName: entry.columnName,
            operation: entry.operation,
            ...(entry.keying ? { keying: entry.keying } : {}),
            rowsAffected: entry.rowsAffected,
        })),
        ...(auditLog.anonymity ? { anonymity: auditLog.anonymity } : {}),
        processingStartedAt: auditLog.createdAt,
        processingCompletedAt: auditLog.completedAt || Date.now(),
    };

    const dataToSign = JSON.stringify(certData, null, 0);

    const signature = await signData(dataToSign, keypair.privateKey);

    return {
        ...certData,
        signature: {
            algorithm: 'ECDSA',
            curve: 'P-256',
            hash: 'SHA-256',
            publicKey: publicKeyBase64,
            signature,
        },
    };
};

export const verifyCertificate = async (cert: Certificate): Promise<boolean> => {
    const { signature, ...certData } = cert;
    const dataToVerify = JSON.stringify(certData, null, 0);

    return verifySignature(dataToVerify, signature.signature, signature.publicKey);
};

export const downloadCertificate = (cert: Certificate): Artifact =>
    downloadBlob(
        new Blob([JSON.stringify(cert, null, 2)], { type: 'application/json' }),
        `certificate-${cert.id.slice(0, 8)}.json`
    );

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
};

const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
};
