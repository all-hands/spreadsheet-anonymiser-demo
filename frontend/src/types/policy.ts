export const POLICY_STRINGS = [
    'keep',
    'redact',
    'mask',
    'mask-email',
    'mask-last4',
    'hash',
    'faux',
    'year',
    'age-band',
    'bucket',
    'encrypt',
    'kyber-aes',
    'legacy-hmac-sha256',
    'legacy-sha256',
    'legacy-mask',
    'legacy-aes',
    'legacy-kyber-aes',
] as const;

export type PolicyType = (typeof POLICY_STRINGS)[number];

export const DEPRECATED_POLICY_STRINGS = ['kyber-aes'] as const satisfies readonly PolicyType[];

export const isDeprecatedPolicy = (t: PolicyType | string): boolean =>
    (DEPRECATED_POLICY_STRINGS as readonly string[]).includes(t);

export const deprecatedPolicyReport = (t: string): string =>
    `${t} (deprecated, refused for new runs: use encrypt)`;

export const GENERALISATION_POLICIES: readonly PolicyType[] = ['year', 'age-band', 'bucket'];

export const isGeneralisation = (t: PolicyType | string): boolean =>
    (GENERALISATION_POLICIES as readonly string[]).includes(t);

export const DEFAULT_GENERALISE_WIDTH = 10;

export const KEY_MATERIAL_STRINGS = ['none', 'column', 'passphrase'] as const;
export type PolicyKeyMaterial = (typeof KEY_MATERIAL_STRINGS)[number];

export const toKeyMaterial = (value: string): PolicyKeyMaterial => {
    if ((KEY_MATERIAL_STRINGS as readonly string[]).includes(value)) {
        return value as PolicyKeyMaterial;
    }
    throw new Error(`unknown key material ${JSON.stringify(value)} from the engine`);
};
export const CANON_TYPE_STRINGS = ['auto', 'text', 'email', 'phone', 'id'] as const;

export type CanonType = (typeof CANON_TYPE_STRINGS)[number];

export const TOKEN_ENCODING_STRINGS = ['hex', 'base32'] as const;

export type TokenEncoding = (typeof TOKEN_ENCODING_STRINGS)[number];

export interface AnonymizeOpts {
    dataset?: string;
    tokenEncoding?: TokenEncoding;
}

export interface ColumnPolicy {
    type: PolicyType;
    canon?: CanonType;
    keying?: 'run';
    width?: number;
    referenceDate?: string;
}

export interface PolicyOption {
    type: PolicyType;
    label: string;
    group: 'standard' | 'legacy';
    basic?: boolean;
    transforms: boolean;
    color: string;
    tint?: string;
}

export const POLICY_OPTIONS: PolicyOption[] = [
    { type: 'keep', label: 'Keep', group: 'standard', basic: true, transforms: false, color: 'text-muted' },
    {
        type: 'redact',
        label: 'Redact',
        group: 'standard',
        basic: true,
        transforms: true,
        color: 'text-danger',
        tint: 'bg-danger/10 text-danger',
    },
    {
        type: 'mask',
        label: 'Mask',
        group: 'standard',
        basic: true,
        transforms: true,
        color: 'text-warning',
        tint: 'bg-warning/10 text-warning',
    },
    { type: 'mask-email', label: 'Mask email', group: 'standard', basic: true, transforms: true, color: 'text-warning' },
    { type: 'mask-last4', label: 'Mask last 4', group: 'standard', basic: true, transforms: true, color: 'text-warning' },
    {
        type: 'hash',
        label: 'Hash',
        group: 'standard',
        basic: true,
        transforms: true,
        color: 'text-info',
        tint: 'bg-info/10 text-info',
    },
    {
        type: 'faux',
        label: 'Faux',
        group: 'standard',
        basic: true,
        transforms: true,
        color: 'text-plum',
        tint: 'bg-plum/10 text-plum',
    },
    {
        type: 'year',
        label: 'Year only',
        group: 'standard',
        basic: true,
        transforms: true,
        color: 'text-accent',
        tint: 'text-accent',
    },
    {
        type: 'age-band',
        label: 'Age band',
        group: 'standard',
        basic: true,
        transforms: true,
        color: 'text-accent',
        tint: 'text-accent',
    },
    {
        type: 'bucket',
        label: 'Number range',
        group: 'standard',
        basic: true,
        transforms: true,
        color: 'text-accent',
        tint: 'text-accent',
    },
    { type: 'encrypt', label: 'Encrypt', group: 'standard', transforms: true, color: 'text-success' },
    { type: 'kyber-aes', label: 'Kyber (deprecated)', group: 'standard', transforms: true, color: 'text-success' },
    { type: 'legacy-hmac-sha256', label: 'Old HMAC', group: 'legacy', transforms: true, color: 'text-violet' },
    { type: 'legacy-sha256', label: 'Old SHA', group: 'legacy', transforms: true, color: 'text-violet' },
    { type: 'legacy-mask', label: 'Old mask', group: 'legacy', transforms: true, color: 'text-violet' },
    { type: 'legacy-aes', label: 'Old AES', group: 'legacy', transforms: true, color: 'text-violet' },
    { type: 'legacy-kyber-aes', label: 'Old qAES', group: 'legacy', transforms: true, color: 'text-violet' },
];

export const SELECTABLE_POLICY_OPTIONS: PolicyOption[] = POLICY_OPTIONS.filter(
    (o) => !isDeprecatedPolicy(o.type)
);

export const BASIC_POLICY_OPTIONS: PolicyOption[] = SELECTABLE_POLICY_OPTIONS.filter((o) => o.basic);

export const BASIC_POLICY_TYPES: readonly PolicyType[] = BASIC_POLICY_OPTIONS.map((o) => o.type);

export const HASH_RUN_CHOICE = 'hash-run';
export const HASH_RUN_LABEL = 'Hash (keyed, this run only)';
export const HASH_UNKEYED_LABEL = 'Hash (unkeyed)';

export const KEYED_SESSION_REQUIRED =
    'Enable the keyed session (passphrase) before using Encrypt: it has no unkeyed form.';
