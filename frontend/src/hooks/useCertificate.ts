import { useCallback, useEffect, useState } from 'react';
import { useAuditStore } from '../store/auditStore';
import { generateCertificate, verifyCertificate, downloadCertificate } from '../lib/crypto/certificate';
import type { Certificate } from '../lib/crypto/certificate';
import { revokeArtifacts } from '../lib/download';
import type { Artifact } from '../lib/download';

export const useCertificate = () => {
    const { currentLog } = useAuditStore();
    const [certificate, setCertificate] = useState<Certificate | null>(null);
    const [isVerified, setIsVerified] = useState<boolean | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [certArtifact, setCertArtifact] = useState<Artifact | null>(null);

    const generateCert = useCallback(async () => {
        if (!currentLog) return;

        setIsGenerating(true);
        setError(null);

        try {
            const cert = await generateCertificate(currentLog);
            setCertificate(cert);
            setCertArtifact((prev) => {
                revokeArtifacts(prev ? [prev] : []);
                return null;
            });

            const verified = await verifyCertificate(cert);
            setIsVerified(verified);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to generate certificate');
        } finally {
            setIsGenerating(false);
        }
    }, [currentLog]);

    useEffect(() => {
        if (currentLog?.status === 'completed' && !certificate) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            generateCert();
        }
    }, [currentLog?.status, certificate, generateCert]);

    const handleDownload = () => {
        if (certificate) {
            setCertArtifact((prev) => {
                revokeArtifacts(prev ? [prev] : []);
                return downloadCertificate(certificate);
            });
        }
    };

    return {
        currentLog,
        certificate,
        isVerified,
        isGenerating,
        error,
        certArtifact,
        generateCert,
        handleDownload,
    };
};
