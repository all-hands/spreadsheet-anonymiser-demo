import type { Notice } from './notices';

export interface ExplainerExample {
    caption: string;
    headers: string[];
    rows: string[][];
    takeaway: string;
}

export interface ExplainerPoint {
    heading: string;
    text: string;
    example?: ExplainerExample;
}

export interface Explainer {
    title: string;
    bottomLine: string;
    points: ExplainerPoint[];
    checklistTitle?: string;
    checklist?: string[];
}

export const CERTIFICATE_EXPLAINER_TITLE = 'Why this is not a guarantee of anonymity';

const PSEUDONYMISED_EXPLAINER: Explainer = {
    title: 'Why this output is not anonymous',
    bottomLine: 'No tool can certify a file as anonymous; this one tells you what it checked and what it did not.',
    points: [
        {
            heading: 'What pseudonymised means',
            text:
                'Names and other direct identifiers are swapped for stand-ins: a token, scrambled text or a ' +
                'made-up value. Every row still describes one person.',
        },
        {
            heading: 'Stand-ins can be linked back',
            text:
                'Anyone with the passphrase can decrypt encrypted columns, and recompute hashed ones by trying ' +
                'likely values. Whenever the same passphrase and salt are reused, the same person gets the same ' +
                'token in every file, so files can be matched even by someone without the key.',
            example: {
                caption: 'The same token in two exports',
                headers: ['File', 'customer_id'],
                rows: [
                    ['This month’s export', 'a1b2c3'],
                    ['Last month’s export', 'a1b2c3'],
                ],
                takeaway: 'Anyone holding both files can see that this is the same person, and follow them over time.',
            },
        },
        {
            heading: 'Kept columns are not changed',
            text:
                'A column left on Keep is exported exactly as it was. Several harmless-looking columns can ' +
                'single someone out together. Studies of population data have found that date of birth, ' +
                'postcode and sex together are unique for a large share of people.',
            example: {
                caption: 'Kept columns that single someone out',
                headers: ['date_of_birth', 'postcode', 'sex'],
                rows: [['1984-03-12', 'AB1 2CD', 'F']],
                takeaway: 'If only one person in the area has this combination, anyone who knows it can find the row.',
            },
        },
        {
            heading: 'Still personal data',
            text:
                'Because people can still be singled out or linked, the output is personal data under GDPR ' +
                '(recital 26). Handle it as such.',
        },
        {
            heading: 'What to do instead',
            text:
                'If you need to share data that is harder to link, switch to Advanced mode and use the ' +
                'Anonymise preset or an Anonymous release. That measures k-anonymity, which is a useful ' +
                'check but still not a guarantee.',
        },
    ],
};

const K_ANONYMITY_EXPLAINER: Explainer = {
    title: 'Why a passed check is not a guarantee of anonymity',
    bottomLine: 'No tool can certify a file as anonymous; this one tells you what it checked and what it did not.',
    points: [
        {
            heading: 'What the check proves',
            text:
                'Every row shares its quasi-identifier values with at least k−1 other rows in this file. ' +
                'Nobody can pick out one row using only those columns.',
        },
        {
            heading: 'It does not stop a shared sensitive value',
            text:
                'If everyone in a group has the same sensitive value, you learn it without knowing which row ' +
                'is theirs.',
            example: {
                caption: 'A group of 5 where everyone has the same diagnosis',
                headers: ['age_band', 'postcode_area', 'diagnosis'],
                rows: [
                    ['30–39', 'AB1', 'diabetes'],
                    ['30–39', 'AB1', 'diabetes'],
                    ['30–39', 'AB1', 'diabetes'],
                    ['30–39', 'AB1', 'diabetes'],
                    ['30–39', 'AB1', 'diabetes'],
                ],
                takeaway: 'Anyone who knows a person aged 30–39 in AB1 is in this file learns they have diabetes.',
            },
        },
        {
            heading: 'It does not cover outside data or unlisted columns',
            text:
                'Only the columns you marked as quasi-identifiers were checked. Another dataset, or a column ' +
                'you left out, may let someone link a row back to a person.',
            example: {
                caption: 'An unlisted column used for linkage',
                headers: ['age_band (checked)', 'employer (not checked)'],
                rows: [['30–39', 'Smith & Co (only 1 row)']],
                takeaway: 'A public staff list for Smith & Co would single this person out.',
            },
        },
        {
            heading: 'It does not read free text',
            text:
                'A notes or comments column can name someone, or describe them, even when every other column ' +
                'passes.',
            example: {
                caption: 'Free text that names a person',
                headers: ['age_band', 'notes'],
                rows: [['30–39', 'Spoke to Jane Smith about her claim']],
                takeaway: 'The group size is fine, but the name is in plain sight.',
            },
        },
        {
            heading: 'It is weak on small files',
            text:
                'With few rows, groups are small and one person who knows the others can narrow things down. ' +
                'Suppression may also have removed so much that the file is no longer useful.',
        },
        {
            heading: 'Anonymous in law is your call',
            text:
                'Under GDPR recital 26, data is anonymous only if people cannot be identified by any means ' +
                'reasonably likely to be used. That is the controller’s assessment. This check is one input to it.',
        },
    ],
    checklistTitle: 'Before you call this file anonymous, consider',
    checklist: [
        'Who will receive it, and what other data could they combine it with?',
        'Did you list every column that could identify someone as a quasi-identifier?',
        'Does any group share one sensitive value?',
        'Does any free-text column name or describe a person?',
        'Is the file small, or did suppression leave very few rows?',
        'Is the release a one-off, or will later versions be linkable to this one?',
        'Have you recorded your assessment and who made it?',
    ],
};

export const explainerFor = (variant: Notice['variant']): Explainer =>
    variant === 'k-anonymity' ? K_ANONYMITY_EXPLAINER : PSEUDONYMISED_EXPLAINER;
