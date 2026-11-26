import {
    CANON_TYPE_STRINGS,
    POLICY_STRINGS,
    TOKEN_ENCODING_STRINGS,
    type CanonType,
    type PolicyType,
    type TokenEncoding,
} from '../types/policy';
import { SUPPRESS_MODES, type SuppressMode } from '../types/anonymity';
import { COLUMN_ROLES, type ColumnRole } from './roles';
import { releaseAllowedProse } from './anonymity';

export const MAX_EXPLANATION_LENGTH = 200;

export const POLICY_EXPLANATIONS: Record<PolicyType, string> = {
    keep: 'Leaves the value exactly as it is. Fine for columns that are not personal.',
    redact: 'Replaces the whole value with [REDACTED]: Jane Smith → [REDACTED]. Cannot be undone.',
    mask: 'Hides part of a value: jane@example.com → j***@example.com. Phone-like numbers keep the last four digits; anything else is redacted.',
    'mask-email': "Hides the name in an email but keeps the domain: jane@example.com → j***@example.com. No @ gives [INVALID EMAIL].",
    'mask-last4': 'Stars everything except the last four characters: 4929123456781234 → ************1234.',
    hash: 'Swaps a value for a token. Equal values give equal tokens, so columns still join. With a passphrase the tokens cannot be guessed from the value.',
    faux: 'Swaps a value for a fixed placeholder by shape: an email becomes faux_user@example.com, a number 0000000000, anything else FAUX_DATA.',
    year: 'Keeps only the year of a date: 1985-03-07 → 1985. Anything that is not a date is redacted.',
    'age-band': 'Turns a date of birth into an age band on a reference date: 34 → 30-39, 90 or over → 90+. Anything that is not a date is redacted.',
    bucket: 'Turns a number into the range that holds it: 27 → 20-29 (width 10). Anything that is not a number is redacted.',
    encrypt: 'Encrypts the value (AES-256-GCM) under your passphrase. Reversible with the same passphrase and dataset name. Needs a keyed session.',
    'kyber-aes': 'Retired: old files can still be decrypted, but new runs refuse it. Use Encrypt instead.',
    'legacy-hmac-sha256': 'Old web app format: HMAC-SHA256 of the value with your passphrase, first 16 hex characters. Only for matching older output.',
    'legacy-sha256': 'Old web app format: SHA-256 of the value with no key, first 16 hex characters. Guessable values can be recovered. For matching older output.',
    'legacy-mask': 'Old web app mask: keeps the first and last character and stars the middle: Alice → A***e. Only for matching older output.',
    'legacy-aes': 'Old web app encryption (enc: cells, passphrase-based). Only for matching or reading older output.',
    'legacy-kyber-aes': 'Old web app "quantum" encryption (qenc: cells, passphrase-based). Only for matching or reading older output.',
};

export const ROLE_EXPLANATIONS: Record<ColumnRole, string> = {
    identifier: 'Names or points straight to a person on its own: name, email, phone, ID number. Suggested policy: Redact.',
    'quasi-identifier': 'Not an identifier alone, but singles people out in combination: date of birth, postcode, city. Generalise it; the check measures it.',
    sensitive: 'A value you want protected that does not identify anyone itself, such as a diagnosis or salary. Suggested policy: Keep.',
    other: 'Not personal data. Suggested policy: Keep.',
};

export const CANON_EXPLANATIONS: Record<CanonType, string> = {
    auto: 'Guesses each value\'s shape (email, phone, text) before hashing, so " Jane@X.com" and "jane@x.com" match. The default.',
    text: 'Trims, lower-cases and collapses spaces before hashing. No email or phone guessing.',
    email: 'Text rules plus Gmail rules: j.doe+spam@gmail.com and jdoe@gmail.com hash the same.',
    phone: 'Keeps only digits and a leading +: (020) 7946 0000 and 02079460000 hash the same.',
    id: 'Trims only and keeps the case, so AB-1 and ab-1 stay different. For IDs and codes.',
};

export const TOKEN_ENCODING_EXPLANATIONS: Record<TokenEncoding, string> = {
    hex: 'Prints hash tokens in hexadecimal, as every earlier run did. Pick this to match old tokens.',
    base32: 'Prints the same tokens about 20% shorter, in letters and digits. The text differs from hex for the same value.',
};

export const SUPPRESS_EXPLANATIONS: Record<SuppressMode, string> = {
    cells: 'Local suppression: in groups smaller than k, the quasi-identifier cells become *, but the rows stay.',
    rows: 'Record suppression: rows in groups smaller than k are dropped from the output.',
};

export const HASH_CHOICE_EXPLANATIONS = {
    'hash-run':
        'Hash with a random secret made for this run, then discarded. Tokens cannot be guessed, but will not match any other run.',
    'hash-unkeyed':
        'Plain SHA-256 with no secret: guessable values (names, short IDs) can be recovered by hashing guesses. Prefer the keyed option.',
} as const;

export const UI_EXPLANATIONS = {
    'app.title': 'Pseudonymises or generalises spreadsheet columns. Everything runs in this browser; your file is never uploaded.',
    'nav.dashboard': 'Set per-column policies and run options, then export.',
    'nav.preview': 'Compare the original and transformed first rows side by side.',
    'nav.certificate': 'A signed record of the last run. A self-check, not proof of origin.',
    'nav.simple': 'Back to the guided mode with fewer options.',
    'nav.advanced': 'Per-column policies, keyed hashing, run options and audit export.',
    'theme': 'Switch the colour theme. Only changes how the page looks.',
    'source': 'Opens this app\'s source code on GitHub in a new tab. Licence: AGPL-3.0-or-later.',
    'explain.toggle': 'Show or hide these hover explanations. Remembered in this browser.',
    'page.heading': 'The page you are on.',

    'dropzone': 'Drop a CSV, TSV, JSONL, Excel or ODS file here, or press Enter to browse. The file stays on this device.',
    'demo.group': 'Made-up sample files to try the tool without your own data.',
    'upload.heading': 'Start here: pick the file to protect.',
    'choose.heading': 'Choose what happens to each column, then export.',
    'file.name': 'The file you loaded.',
    'file.choose': 'Pick a CSV, TSV, JSONL, Excel or ODS file from this device.',
    'file.clear': 'Forgets the file and every setting made for it, including the keyed session.',
    'file.different': 'Go back and pick another file. Your column choices here are lost.',

    'col.column': 'The column heading in your file, and its position (counting from 0).',
    'col.type': 'What the tool guessed from the values: text, number, date, email and so on.',
    'col.samples': 'The first few values of the column, shortened. Hover a value to see it whole.',
    'col.policy': 'What to do with this column on export. Hover the menu for what the chosen option does.',
    'col.index': 'Column position, counting from 0.',
    'chooser.count': 'How many columns will change. Columns left on Keep are copied as they are.',
    'action.anonymise': 'Applies your choices and downloads the data file with its audit log. Nothing downloads before this.',

    'status': 'What the last action did, or the error it hit.',
    'progress': 'How much of a large file has been processed so far.',
    'action.cancel': 'Stops the run. Nothing is downloaded.',
    'download.link': 'A saved copy of a file this run made. Click to download it again if the browser blocked it.',

    'card.source': 'The file you are working on.',
    'card.status': 'Progress and result of the last run, with download links.',
    'card.keyed': 'A passphrase makes Hash tokens reproducible and unlocks Encrypt. It is never stored.',
    'card.action': 'Run the chosen policies and download the result.',
    'card.options': 'Settings shared by every column in the run.',
    'card.policy': 'Save the column policies to a file, or load a saved set.',
    'card.decrypt': 'Turns cells encrypted by this tool back into the original values.',
    'key.passphrase': 'Secret used to derive keys. The same passphrase, salt and dataset name give the same tokens. Not stored.',
    'key.derive': 'Derives the session key (Argon2id) from your passphrase. Enables keyed Hash and Encrypt.',
    'key.clear': 'Discards the session key and passphrase from memory.',
    'key.active': 'A session key is held in memory for this tab only.',
    'action.process': 'Applies the policies and downloads the data file, plus the audit log (and the salt file when keyed).',
    'opt.dataset': 'A name mixed into the keys so different datasets never share tokens. Empty means plain keys. Must match when decrypting.',
    'opt.encoding': 'How hash tokens are printed. Hover for the chosen alphabet.',
    'policy.export': 'Downloads the column policies as policy.json, which the command-line tool also reads. Roles are not included.',
    'policy.import': 'Applies a policy.json saved earlier to the columns with matching names.',
    'action.decrypt': 'Decrypts enc:v1: cells with the session key. The dataset name must match the run that encrypted them.',

    'bulk.title': 'Apply one policy to many columns at once.',
    'bulk.policy': 'The policy to apply. Hover for what the current choice does.',
    'bulk.scope': 'Which columns Apply changes: all, the ticked ones, or those still on Keep.',
    'bulk.apply': 'Sets the chosen policy on the chosen columns.',
    'bulk.reset': 'Puts every column back on Keep. Can be undone.',
    'bulk.undo': 'Reverts the last bulk, preset or plan change.',
    'presets.title': 'One-click starting points. You can still adjust each column afterwards.',
    'preset.pseudonymise': 'Identifiers get a keyed token, free text is redacted, the rest is kept. The output is still personal data.',
    'preset.anonymise': 'Redacts identifiers, then generalises quasi-identifiers until every group has k rows. Measured on this file only.',

    'roles.title': 'Roles label columns so the tool can suggest policies and run the check. Not saved in policy.json.',
    'roles.suggest': "Replaces every column's policy with its role's suggestion, including ones you set by hand.",
    'role.select': 'The role of this column. Hover for what the chosen role means.',
    'role.warning': 'A quasi-identifier on Keep keeps its exact values, so rare combinations stay visible.',

    'grid.region': 'Column headings with their role and policy, over a live preview of the first rows.',
    'grid.selectAll': 'Ticks every column, for Bulk apply.',
    'grid.clear': 'Unticks every column.',
    'grid.selectColumn': 'Tick to include this column in Bulk apply (Selected columns).',
    'grid.count': 'How many columns are ticked for Bulk apply.',
    'grid.preview': 'The cells below show what the current policies would produce.',
    'policy.select': 'The policy for this column. Hover for what the chosen one does.',
    'canon.select': 'How equal values are made equal before hashing. Hover for the chosen type.',
    'param.width': 'Width of each range: 10 gives 20-29, 30-39. Blank means 10.',
    'param.refdate': "The date ages are worked out on (yyyy-mm-dd), never read from the clock. Pre-filled with 1 January this year.",

    'anon.title': 'Counts how many rows share the same quasi-identifier values, on the values as they would be exported.',
    'anon.k': 'k: the smallest group size you accept. Every combination should appear in at least k rows (2 to 50).',
    'anon.mode': 'What to do with groups smaller than k. Hover for the chosen mode.',
    'anon.measure': 'Runs the policies on your data and counts group sizes for the quasi-identifier columns.',
    'stat.minGroup': 'Size of the smallest group of rows that look identical on the quasi-identifiers.',
    'stat.belowK': 'Rows in groups smaller than k. These are the ones that stand out.',
    'stat.groups': 'Number of distinct combinations of quasi-identifier values.',
    'stat.rows': 'Rows measured (after exclusions).',
    'anon.chooseRows': 'Lists the rows below k so you can leave some out of the output.',
    'anon.selectAll': 'Ticks every listed row.',
    'anon.clearSelection': 'Unticks every listed row.',
    'anon.ignore': 'Excludes the ticked rows from the output, then measures again.',
    'anon.ignoreRow': 'Tick to leave this row out of the output.',
    'plan.title': 'Looks for the least generalisation that reaches k.',
    'plan.budget': 'The most rows you accept losing to suppression, as a share of all rows.',
    'plan.check': 'Searches for a plan without changing anything.',
    'plan.apply': 'Changes policies as planned, switches on Anonymous release and measures again.',
    'release.switch': `Anonymous release: only ${releaseAllowedProse()}; small groups suppressed; no salt file; exported only if the check passes.`,

    'rows.title': 'Rows that will be exported. Tick a row to leave it out.',
    'rows.clear': 'Puts every excluded row back.',
    'rows.exclude': 'Tick to leave this row out of the export. Exclusions are not recorded in the audit log.',
    'rows.region': 'Every row of the file. Scroll to find the ones to exclude.',

    'audit.title': 'What the last run did, column by column. Feeds the certificate.',
    'audit.tile': 'How many columns used this policy in the last run.',
    'audit.entry': 'One column: its policy and how many rows it changed.',
    'audit.status': 'Whether the last run is still going, finished or failed.',

    'preview.title': 'The first rows before and after the policies.',
    'preview.original': 'Your data as loaded.',
    'preview.anonymised': 'The same rows after the policies. Highlighted columns changed.',
    'preview.column': 'A column heading and its detected type.',
    'preview.region': 'Scroll to see more rows and columns. Both panes move together.',

    'cert.title': 'The audit log plus a signature made in this browser. It detects accidental changes; it is not proof of origin.',
    'cert.print': 'Opens the print dialogue for this certificate.',
    'cert.download': 'Saves the certificate as a JSON file.',
    'cert.retry': 'Tries to sign the certificate again.',
    'cert.generate': 'Signs the audit log of the finished run.',
    'cert.copy': 'Copies this value to the clipboard.',
    'cert.tile': 'How many columns used this policy in this run.',
    'cert.sec.anonymity': 'The measured k-anonymity result for this run: smallest group and rows suppressed. A measurement, not a guarantee.',
    'cert.sec.file': 'The file that was processed: name, size, SHA-256 hash, and row and column counts as recorded for this run.',
    'cert.sec.summary': 'How many columns each policy was applied to in this run.',
    'cert.sec.operations': 'Each column, the policy applied to it and how many rows it changed.',
    'cert.sec.signature': 'The signature and public key. They detect accidental changes to this certificate; they do not show who made it.',
    'cert.sec.timestamps': "When processing started and finished, and when this certificate was created, by this device's clock.",
    'cert.sec.why': 'What this tool did and did not check, and why its output is not a guarantee of anonymity.',
    'notice.why.pseudonymised': 'Shows or hides why pseudonymised output is still personal data, and what to do instead.',
    'notice.why.k-anonymity': 'Shows or hides what a passed k-anonymity check proves, and what it does not.',
    'cert.status': "Whether the certificate's signature matches its contents.",

    'error.heading': 'The page hit an unexpected error. Your file never left this device.',
    'error.retry': 'Reloads this part of the page.',
    'error.reload': 'Starts again from the front page. You will need to pick your file again.',
} as const;

export type UiExplanationKey = keyof typeof UI_EXPLANATIONS;
export type ExplanationKey =
    | UiExplanationKey
    | `policy:${PolicyType}`
    | `role:${ColumnRole}`
    | `canon:${CanonType}`
    | `encoding:${TokenEncoding}`
    | `suppress:${SuppressMode}`
    | `choice:${keyof typeof HASH_CHOICE_EXPLANATIONS}`;

export const explanationFor = (key: ExplanationKey): string | undefined => {
    const i = key.indexOf(':');
    if (i < 0) return (UI_EXPLANATIONS as Record<string, string>)[key];
    const group = key.slice(0, i);
    const value = key.slice(i + 1);
    const table: Record<string, Record<string, string>> = {
        policy: POLICY_EXPLANATIONS,
        role: ROLE_EXPLANATIONS,
        canon: CANON_EXPLANATIONS,
        encoding: TOKEN_ENCODING_EXPLANATIONS,
        suppress: SUPPRESS_EXPLANATIONS,
        choice: HASH_CHOICE_EXPLANATIONS,
    };
    return table[group]?.[value];
};

export const allExplanationKeys = (): ExplanationKey[] => [
    ...(Object.keys(UI_EXPLANATIONS) as UiExplanationKey[]),
    ...POLICY_STRINGS.map((p) => `policy:${p}` as const),
    ...COLUMN_ROLES.map((r) => `role:${r}` as const),
    ...CANON_TYPE_STRINGS.map((c) => `canon:${c}` as const),
    ...TOKEN_ENCODING_STRINGS.map((e) => `encoding:${e}` as const),
    ...SUPPRESS_MODES.map((m) => `suppress:${m}` as const),
    ...(Object.keys(HASH_CHOICE_EXPLANATIONS) as (keyof typeof HASH_CHOICE_EXPLANATIONS)[]).map(
        (c) => `choice:${c}` as const
    ),
];
