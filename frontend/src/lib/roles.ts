import type { ColumnMetadata, ColumnType, RowData } from '../types/data';
import { isDateValue } from './detectors';
import type { ColumnPolicy } from '../types/policy';

export const COLUMN_ROLES = ['identifier', 'quasi-identifier', 'sensitive', 'other'] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];

export const ROLE_LABELS: Record<ColumnRole, string> = {
    identifier: 'Identifier',
    'quasi-identifier': 'Quasi-identifier',
    sensitive: 'Sensitive',
    other: 'Other',
};

export const ROLE_HELP: Record<ColumnRole, string> = {
    identifier: 'Directly names or points to a person (name, email, phone, ID). Suggested: redact.',
    'quasi-identifier':
        'Indirectly identifying in combination (date of birth, postcode, age, city, gender). Suggested: generalise; measured by the anonymity check.',
    sensitive: 'A value you protect but that does not identify (diagnosis, salary). Suggested: keep.',
    other: 'Not personal. Suggested: keep.',
};

const TYPE_IDENTIFIER: readonly ColumnType[] = ['email', 'phone', 'credit-card', 'ssn', 'url', 'ip'];

const SENSITIVE = new Set([
    'diagnosis', 'diagnoses', 'condition', 'health', 'medical', 'salary', 'income', 'wage',
    'religion', 'ethnicity', 'disability', 'medication', 'illness', 'pay', 'treatment', 'prescription',
    'balance', 'earnings',
]);
const QUASI = new Set([
    'dob', 'birth', 'birthday', 'birthdate', 'age', 'postcode', 'postal', 'zip', 'zipcode',
    'city', 'town', 'gender', 'sex', 'region', 'county', 'country', 'state', 'occupation', 'job',
    'dateofbirth', 'yob', 'postalcode', 'lat', 'lng', 'lon', 'long', 'latitude', 'longitude', 'location',
    'department', 'dept', 'division', 'team', 'jobtitle', 'position', 'startdate', 'hiredate', 'joindate',
    'joined', 'hired', 'hire', 'employed', 'nationality', 'marital', 'ethnicgroup', 'street', 'suburb',
]);
const IDENTIFIER = new Set([
    'id', 'uuid', 'guid', 'email', 'mail', 'name', 'firstname', 'lastname', 'surname', 'fullname',
    'phone', 'mobile', 'tel', 'telephone', 'ssn', 'nino', 'passport', 'iban', 'account', 'username',
    'address', 'ip', 'url', 'fname', 'lname', 'forename', 'givenname', 'familyname', 'sortcode', 'swift',
    'bic', 'licence', 'license', 'patient',
]);

const tokens = (header: string): string[] =>
    header
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);

const AMBIGUOUS_IDENTIFIER = new Set([
    'id', 'uuid', 'guid', 'mail', 'account', 'ip', 'url', 'licence', 'license', 'patient', 'swift', 'bic', 'name',
]);
const PERSON_NAME_QUALIFIER = new Set([
    'first', 'last', 'full', 'given', 'family', 'middle', 'maiden', 'sur', 'user', 'display', 'preferred', 'legal',
    'customer', 'patient', 'employee', 'client', 'contact', 'member', 'person', 'owner', 'applicant', 'student',
    'e', 'my', 'your',
]);
const ACCOUNT_NUMBER_WORD = new Set(['number', 'no', 'num', 'nr', 'id', 'code']);

export const headerNamesDirectIdentifier = (header: string): boolean => {
    const t = tokens(header);
    if (t.length === 0) return false;
    const joined = t.join('');
    const pairs = t.slice(1).map((w, i) => t[i] + w);
    const words = new Set([...t, joined, ...pairs]);
    for (const w of words) {
        if (IDENTIFIER.has(w) && !AMBIGUOUS_IDENTIFIER.has(w)) return true;
    }
    if (words.has('email')) return true;
    if (t.includes('name') && t.every((w) => w === 'name' || PERSON_NAME_QUALIFIER.has(w))) return true;
    if (t.includes('account') && t.some((w) => ACCOUNT_NUMBER_WORD.has(w))) return true;
    if (t.includes('national') && t.includes('insurance')) return true;
    if (t.includes('ni') && t.some((w) => ACCOUNT_NUMBER_WORD.has(w))) return true;
    return false;
};

export const suggestRole = (header: string, type: ColumnType): ColumnRole => {
    const t = tokens(header);
    const joined = t.join('');
    const pairs = t.slice(1).map((w, i) => t[i] + w);
    const has = (set: Set<string>) => t.some((w) => set.has(w)) || set.has(joined) || pairs.some((w) => set.has(w));
    if (has(SENSITIVE)) return 'sensitive';
    if (has(QUASI)) return 'quasi-identifier';
    if (TYPE_IDENTIFIER.includes(type)) return 'identifier';
    if (has(IDENTIFIER)) return 'identifier';
    return 'other';
};

export const isDateColumn = (rows: readonly RowData[], index: number): boolean => {
    let seen = 0;
    for (const row of rows) {
        const cell = row[index];
        if (cell === null || cell === undefined || String(cell).trim() === '') continue;
        if (!isDateValue(String(cell))) return false;
        seen++;
    }
    return seen > 0;
};

export const columnType = (
    metadata: ColumnMetadata[],
    rows: readonly RowData[],
    index: number
): ColumnType => {
    const type = metadata.find((m) => m.index === index)?.type ?? 'text';
    return type !== 'date' && isDateColumn(rows, index) ? 'date' : type;
};

export const suggestRoles = (
    headers: string[],
    metadata: ColumnMetadata[],
    rows: readonly RowData[] = []
): Record<number, ColumnRole> => {
    const roles: Record<number, ColumnRole> = {};
    headers.forEach((h, i) => {
        roles[i] = suggestRole(h, columnType(metadata, rows, i));
    });
    return roles;
};

export const isNumericColumn = (rows: readonly RowData[], index: number): boolean => {
    let seen = 0;
    for (const row of rows) {
        const cell = row[index];
        if (cell === null || cell === undefined || String(cell).trim() === '') continue;
        if (!Number.isFinite(Number(String(cell).trim()))) return false;
        seen++;
    }
    return seen > 0;
};

export const suggestedPolicyForRole = (
    role: ColumnRole,
    type: ColumnType,
    numeric: boolean
): ColumnPolicy => {
    switch (role) {
        case 'identifier':
            return { type: 'redact' };
        case 'quasi-identifier':
            if (type === 'date') return { type: 'year' };
            if (numeric) return { type: 'bucket' };
            return { type: 'keep' };
        default:
            return { type: 'keep' };
    }
};

export const isUngeneralisedQuasi = (role: ColumnRole | undefined, policy?: ColumnPolicy): boolean =>
    role === 'quasi-identifier' && (policy?.type ?? 'keep') === 'keep';
