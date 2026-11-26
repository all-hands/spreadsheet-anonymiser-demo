import type { ReactNode } from 'react';
import { useCertificate } from '../hooks/useCertificate';
import DownloadLinks from './DownloadLinks';
import Explain from './Explain';
import { CertificateBody } from './certificate/CertificateBody';
import { clsx } from 'clsx';
import {
    ShieldCheck,
    ShieldExclamationPoint,
    Download,
    FileText,
    Clock,
    CircleExclamationPoint,
    LoaderCircle,
    Printer
} from 'lucide-react';

const StatusScreen = ({
    icon: Icon,
    title,
    subtitle,
    action,
    tone = 'muted'
}: {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    title: string;
    subtitle: ReactNode;
    action?: ReactNode;
    tone?: 'muted' | 'red';
}) => (
    <div className={clsx('flex-1 flex items-center justify-center', tone === 'red' ? 'text-danger' : 'text-muted')}>
        <div className="text-center">
            <Icon size={48} className="mx-auto mb-4 opacity-50" />
            <p className="text-lg">{title}</p>
            <p className="text-sm mt-2">{subtitle}</p>
            {action}
        </div>
    </div>
);

const CertificateView = () => {
    const { currentLog, certificate, isVerified, isGenerating, error, certArtifact, generateCert, handleDownload } =
        useCertificate();

    if (!currentLog) {
        return (
            <StatusScreen
                icon={FileText}
                title="No Certificate Available"
                subtitle="Process a file to generate an audit certificate"
            />
        );
    }

    if (isGenerating) {
        return (
            <StatusScreen
                icon={LoaderCircle}
                title="Generating Certificate"
                subtitle="Signing with ECDSA P-256..."
            />
        );
    }

    if (error) {
        return (
            <StatusScreen
                icon={CircleExclamationPoint}
                title="Certificate Generation Failed"
                subtitle={error}
                tone="red"
                action={
                    <Explain k="cert.retry">
                        <button
                            onClick={generateCert}
                            className="mt-4 px-4 py-2 bg-danger/20 rounded-sm hover:bg-danger/30 transition"
                        >
                            Retry
                        </button>
                    </Explain>
                }
            />
        );
    }

    if (!certificate) {
        return (
            <StatusScreen
                icon={Clock}
                title="Waiting for Processing"
                subtitle="Complete file processing to generate a certificate"
                action={
                    currentLog.status === 'completed' && (
                        <Explain k="cert.generate">
                            <button
                                onClick={generateCert}
                                className="mt-4 px-4 py-2 bg-surface-2 rounded-sm hover:bg-surface-hover transition"
                            >
                                Generate Certificate
                            </button>
                        </Explain>
                    )
                }
            />
        );
    }

    return (
        <div className="flex-1 p-6 overflow-auto">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    {isVerified ? (
                        <ShieldCheck size={32} className="text-success" />
                    ) : (
                        <ShieldExclamationPoint size={32} className="text-danger" />
                    )}
                    <div>
                        <Explain k="cert.title"><h2 className="text-xl font-semibold">Audit Certificate</h2></Explain>
                        <Explain k="cert.status">
                        <p className={clsx(
                            "text-sm",
                            isVerified ? "text-success" : "text-danger"
                        )}>
                            {isVerified ? 'Integrity self-check passed ✓' : 'Integrity self-check failed ✗'}
                        </p>
                        </Explain>
                        <p className="text-xs text-muted mt-0.5">
                            Signed with a one-time key made in this browser and stored in the
                            certificate. The check detects accidental changes; it is not proof of
                            origin, and anyone can make a certificate that passes it.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Explain k="cert.print">
                    <button
                        onClick={() => window.print()}
                        className="flex items-center gap-2 px-4 py-2 bg-surface-2 rounded-sm hover:bg-surface-hover transition focus:outline-hidden focus:ring-2 focus:ring-accent"
                    >
                        <Printer size={16} />
                        Print
                    </button>
                    </Explain>
                    <Explain k="cert.download">
                    <button
                        onClick={handleDownload}
                        className="flex items-center gap-2 px-4 py-2 bg-surface-2 rounded-sm hover:bg-surface-hover transition focus:outline-hidden focus:ring-2 focus:ring-accent"
                    >
                        <Download size={16} />
                        Download JSON
                    </button>
                    </Explain>
                </div>
            </div>

            {certArtifact && <DownloadLinks artifacts={[certArtifact]} />}

            <CertificateBody certificate={certificate} />
        </div>
    );
};

export default CertificateView;
