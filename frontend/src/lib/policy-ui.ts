import {
    CircleCheckBig,
    ShieldExclamationPoint,
    EyeOff,
    Hash,
    FileCode,
    Lock,
    RotateCcwClock,
    Calendar,
    CalendarRange,
    Layers,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { HASH_RUN_LABEL, POLICY_OPTIONS, type PolicyType } from '../types/policy';

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
export type PolicyIconComponent = IconComponent;

export const policyLabel = (op: PolicyType | string): string =>
    POLICY_OPTIONS.find((o) => o.type === op)?.label ?? op;

export const operationLabel = (op: PolicyType | string, keying?: 'run'): string =>
    keying === 'run' && op === 'hash' ? HASH_RUN_LABEL : policyLabel(op);

const ICONS: Record<PolicyType, IconComponent> = {
    keep: CircleCheckBig,
    redact: ShieldExclamationPoint,
    mask: EyeOff,
    'mask-email': EyeOff,
    'mask-last4': EyeOff,
    hash: Hash,
    faux: FileCode,
    year: Calendar,
    'age-band': CalendarRange,
    bucket: Layers,
    encrypt: Lock,
    'kyber-aes': Lock,
    'legacy-hmac-sha256': RotateCcwClock,
    'legacy-sha256': RotateCcwClock,
    'legacy-mask': RotateCcwClock,
    'legacy-aes': RotateCcwClock,
    'legacy-kyber-aes': RotateCcwClock,
};

export const POLICY_ICONS = ICONS;

const COLORS: Record<PolicyType, string> = Object.fromEntries(
    POLICY_OPTIONS.map((o) => [o.type, o.color])
) as Record<PolicyType, string>;

export const policyIcon = (op: PolicyType | string): IconComponent =>
    ICONS[op as PolicyType] ?? CircleCheckBig;

export const policyColor = (op: PolicyType | string): string =>
    COLORS[op as PolicyType] ?? 'text-muted';

export const policyTint = (op: PolicyType | string): string | undefined =>
    POLICY_OPTIONS.find((o) => o.type === op)?.tint;
