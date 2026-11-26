import { CircleCheckBig } from 'lucide-react';
import type { PolicyType } from '../types/policy';
import { POLICY_ICONS } from '../lib/policy-ui';

export const PolicyIcon = ({
    operation,
    size = 16,
    className,
}: {
    operation: PolicyType | string;
    size?: number;
    className?: string;
}) => {
    const Icon = POLICY_ICONS[operation as PolicyType] ?? CircleCheckBig;
    return <Icon size={size} className={className} />;
};
