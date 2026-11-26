import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import type { Certificate } from '../../lib/crypto/certificate';
import { operationLabel, policyColor, policyIcon, policyLabel, type PolicyIconComponent } from '../../lib/policy-ui';
import { formatBytes } from '../../lib/format';
import { PseudonymisationNotice } from '../PseudonymisationNotice';
import { ExplainerBody } from '../NoticeExplainer';
import { CERTIFICATE_EXPLAINER_TITLE, explainerFor } from '../../lib/notice-explainers';
import { noticeFor } from '../../lib/notices';
import Explain from '../Explain';
import type { UiExplanationKey } from '../../lib/explanations';
import { CopyButton } from './CopyButton';

export const CertificateBody = ({ certificate }: { certificate: Certificate }) => (
    <div className="space-y-6 print:space-y-4">
        <PseudonymisationNotice anonymity={certificate.anonymity ?? null} withExplainer={false} />

        {certificate.anonymity && (
            <Section title="Anonymity Check" explain="cert.sec.anonymity">
                <p className="text-sm font-medium">{certificate.anonymity.statement}</p>
                <InfoRow label="Quasi-identifiers" value={certificate.anonymity.quasiIdentifiers.join(', ')} />
                <InfoRow label="Smallest group" value={certificate.anonymity.minGroup.toString()} />
                <InfoRow label="Rows suppressed" value={certificate.anonymity.rowsSuppressed.toString()} />
                <p className="mt-2 text-xs text-muted">{certificate.anonymity.claim}</p>
            </Section>
        )}

        <Section title="File Information" explain="cert.sec.file">
            <InfoRow label="Filename" value={certificate.fileInfo.filename} />
            <InfoRow label="Size" value={formatBytes(certificate.fileInfo.fileSize)} />
            <div className="py-1">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">SHA-256 Hash</span>
                    <CopyButton text={certificate.fileInfo.fileHash} label="Copy SHA-256 hash" />
                </div>
                <div
                    data-testid="file-hash"
                    className="mt-1 font-mono text-xs p-2 rounded-sm break-all"
                >
                    {certificate.fileInfo.fileHash}
                </div>
            </div>
            <InfoRow label="Total Rows" value={certificate.fileInfo.totalRows.toLocaleString()} />
            <InfoRow label="Total Columns" value={certificate.fileInfo.totalColumns.toString()} />
        </Section>

        <Section title="Transformation Summary" explain="cert.sec.summary">
            <div className="grid grid-cols-4 gap-4 text-center">
                {Object.entries(certificate.summary.byOperation).map(([op, count]) => (
                    <SummaryCard
                        key={op}
                        label={policyLabel(op)}
                        value={count}
                        color={policyColor(op)}
                        icon={policyIcon(op)}
                    />
                ))}
            </div>
        </Section>

        <Section title="Operations Log" explain="cert.sec.operations">
            {certificate.operations.length === 0 ? (
                <div className="text-center py-4 text-muted">
                    No transformations applied - all columns kept as-is
                </div>
            ) : (
                <div className="space-y-2">
                    {certificate.operations.map((op, idx) => (
                        <div
                            key={idx}
                            className="flex items-center justify-between py-2 px-3 bg-surface-2 rounded-sm"
                        >
                            <span className="font-medium">{op.columnName}</span>
                            <div className="flex items-center gap-4">
                                <span className="text-sm text-muted uppercase">
                                    {operationLabel(op.operation, op.keying)}
                                </span>
                                <span className="text-sm text-muted">{op.rowsAffected} rows</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Section>

        <Section title="Integrity Signature" explain="cert.sec.signature">
            <InfoRow label="Algorithm" value="ECDSA" />
            <InfoRow label="Curve" value="P-256 (secp256r1)" />
            <InfoRow label="Hash" value="SHA-256" />
            <div className="mt-3">
                <div className="text-xs text-muted mb-1">Public Key (SPKI)</div>
                <div className="font-mono text-xs p-2 rounded-sm break-all">
                    {certificate.signature.publicKey.slice(0, 60)}...
                </div>
            </div>
            <div className="mt-3">
                <div className="text-xs text-muted mb-1">Signature</div>
                <div className="font-mono text-xs p-2 rounded-sm break-all">
                    {certificate.signature.signature.slice(0, 60)}...
                </div>
            </div>
        </Section>

        <Section title="Timestamps" explain="cert.sec.timestamps">
            <InfoRow
                label="Processing Started"
                value={new Date(certificate.processingStartedAt).toLocaleString()}
            />
            <InfoRow
                label="Processing Completed"
                value={new Date(certificate.processingCompletedAt).toLocaleString()}
            />
            <InfoRow
                label="Certificate Created"
                value={new Date(certificate.createdAt).toLocaleString()}
            />
        </Section>

        <Section title={CERTIFICATE_EXPLAINER_TITLE} explain="cert.sec.why">
            <ExplainerBody explainer={explainerFor(noticeFor(certificate.anonymity ?? null).variant)} />
        </Section>
    </div>
);

export const Section = ({ title, explain, children }: { title: string; explain: UiExplanationKey; children: ReactNode }) => (
    <div className="border border-border rounded-lg p-4">
        <Explain k={explain}>
            <h3 className="text-sm font-semibold text-muted mb-3">{title}</h3>
        </Explain>
        {children}
    </div>
);

export const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between py-1">
        <span className="text-sm text-muted">{label}</span>
        <span className="text-sm font-medium">{value}</span>
    </div>
);

const SummaryCard = ({
    label,
    value,
    color,
    icon: Icon
}: {
    label: string;
    value: number;
    color: string;
    icon: PolicyIconComponent;
}) => (
    <Explain k="cert.tile">
        <div className="p-3 bg-surface-2 rounded-lg">
            <Icon size={20} className={clsx(color, "mx-auto mb-1")} />
            <div className={clsx("text-2xl font-bold", color)}>{value}</div>
            <div className="text-xs text-muted">{label}</div>
        </div>
    </Explain>
);
