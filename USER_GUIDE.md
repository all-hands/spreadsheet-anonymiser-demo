# Spreadsheet Anonymiser: user guide

This guide shows how to use the app from start to finish: load a file, choose a
policy for each column, set a passphrase and salt, download the result, and
get the same result from the command-line tool. Read section 1 first. It
explains what the output is, and what it is not.

Contents:

1. [What it does, and what it does not](#1-what-it-does-and-what-it-does-not)
2. [The demo files](#2-the-demo-files)
3. [A quick run: Simple mode](#3-a-quick-run-simple-mode)
4. [Choosing a policy for each column](#4-choosing-a-policy-for-each-column)
5. [Advanced mode: passphrase, salt and download](#5-advanced-mode-passphrase-salt-and-download)
6. [Optional: a measured release](#6-optional-a-measured-release)
7. [The command-line tool](#7-the-command-line-tool)

## 1. What it does, and what it does not

The app replaces the values in the columns you choose. Each column has its own
policy: keep it, redact it, mask it, hash it, replace it with a placeholder,
generalise it (a date becomes a year, a number becomes a range) or encrypt it.

Everything happens on your device. In the browser, the file is read and
transformed inside a Web Worker that runs WebAssembly. The server only serves
the app's files, and the page allows connections to its own address only. The
command-line tool is a local program. Neither one sends your data anywhere.

The output is **pseudonymised, not anonymous**. Treat it as personal data:

- Columns you leave in clear, or only partly masked, can identify people, on
  their own or in combination. Small groups are easy to single out.
- Anyone who holds the passphrase and the salt file can recompute the keyed
  tokens. An unkeyed hash of a guessable value, such as a name or a short ID,
  can be recovered by hashing guesses.
- The app shows a notice beside the download button and on the certificate. The
  command-line tool prints a notice on every run.

No tool can certify a file as anonymous. Look at the output before you share it.

## 2. The demo files

The app offers five demo files. All of them are made up: the names are
placeholders, the emails use `example.org`, and no row refers to a real person.
They are served from the app itself, so loading one sends nothing anywhere.

| File | Format | Rows | What it holds |
|---|---|---|---|
| Customers | CSV | 60 | id, name, email, phone, date of birth, postcode, city, salary, plan, signup date |
| Patients | TSV | 40 | patient ID, name, date of birth, postcode, diagnosis (sensitive), height, weight, visit date, clinician |
| Orders | JSONL | 40 | order ID, customer name and email, ship city and postcode, item, quantity, total, order date |
| Employees | Excel (`.xlsx`) | 30 | staff records with salary and bank sort codes |
| Volunteers | ODS (`.ods`) | 30 | volunteer ID, name, email, phone, date of birth, postcode, city, allergy (sensitive), shift start, hours |

To use your own file, choose a CSV, TSV, JSONL, Excel or ODS file. The app reads
it in your browser and makes a new file for you to download. The original file
is not changed.

The demo files are small. A measured release on them, at the default k of 5,
will often be blocked or heavily suppressed. That is the check doing its job.

## 3. A quick run: Simple mode

The app opens in Simple mode (`/simple`). It is the short path for a one-off
file.

1. **Load a file.** Drop it on the dropzone, choose it with the file picker, or
   click one of the demo files.
2. **Check the column chooser.** Each column shows its position, a detected type,
   three sample values and an "Anonymisation" menu. The app suggests Mask for
   every column whose detected type is not plain text (`email`, `phone`, `date`,
   `credit-card`, `ssn` for a US social security number such as 123-45-6789,
   `url` or `ip`), and Keep for the rest. Names are plain text, so they start
   as Keep. Read every column and change what needs changing.
3. **Choose an action for each column.** The menu offers Keep, Redact, Mask,
   Mask email, Mask last 4, Hash (unkeyed), Hash (keyed, this run only), Faux,
   Year only, Age band and Number range. Section 4 explains each one. A line
   under the table says how many columns will change.
4. **Read the notes.** Some choices show a short note:
   - *Unkeyed hash*: a guessable value can be recovered by hashing guesses.
   - *Hash (keyed, this run only)*: the app makes a random secret for this run and
     discards it. The tokens cannot be reversed or guessed, but they will not
     match the tokens of any other run or file.
   - *Age band*: ages are worked out on the reference date shown, which is
     1 January of the current year. Bands are ten years wide, with a top band of
     90+. Dates must be year first (`yyyy-mm-dd`). Any other value becomes
     `[REDACTED]`.
5. **Click "Anonymise & download".** Nothing downloads until you click. The output
   downloads as `anonymized-<original name>`, in the same format as your input. A
   link to the audit log (`<name>_audit.json`) appears below the download.

Simple mode has no passphrase, no salt file, no row exclusion, no anonymity check
and no certificate. For those, the column chooser links to Advanced mode.

## 4. Choosing a policy for each column

Every policy below works on one column. The "Use it when" column is a guide,
not a rule.

| Policy | What it does to a value | Use it when |
|---|---|---|
| Keep | Leaves the value as it is. | The column is not personal, or you have checked it. |
| Redact | Replaces the whole value with `[REDACTED]`. | You do not need the content: names, addresses, free-text identifiers. This is the safest choice for direct identifiers. |
| Mask | Keeps part of the value and stars the rest. An email keeps its first character and its domain. A phone number or other number keeps its last four characters. Other text becomes `[REDACTED]`. | You want a recognisable shape. The visible part still carries information. |
| Mask email | As Mask, for emails only. Anything that is not an email becomes `[INVALID EMAIL]`. | The column should hold emails, and you want bad values flagged. |
| Mask last 4 | Keeps the last four characters and stars the rest. Anything else becomes `[REDACTED]`. | Card or account numbers, where the last four are acceptable. |
| Hash | Replaces the value with a token. Equal values give equal tokens, so you can count and join on the column. With a passphrase session the token is keyed. Without one it is plain SHA-256, and the app warns you. | You need to count or join by the value, but must not show it. Use a passphrase. |
| Faux | Replaces the value with a fixed placeholder of the same shape: `faux_user@example.com` for emails, zeros for numbers, `FAUX_DATA` otherwise. It is not realistic data. | A column must look filled in, for a test system, without any information in it. |
| Year only | Turns a date into its four-digit year. | Dates of birth or joining dates, where the year is enough. |
| Age band | Turns a date of birth into an age band (`30-39`, top band `90+`) on the reference date. | Age ranges are enough. |
| Number range | Turns a number into a range such as `20-29`. The width defaults to 10. | Salaries, scores or quantities, where a range is enough. |
| Encrypt | Replaces the value with an `enc:v1:` ciphertext. The same passphrase, salt and dataset can decrypt it. Needs an active passphrase session. | You must be able to get the original value back later. |

The generalisation policies (Year only, Age band, Number range) need no key.
Dates must be year first (`yyyy-mm-dd`, `yyyy/mm/dd` or `yyyy.mm.dd`). Day-first
and month-first dates are refused, because the app cannot tell them apart. A value
that cannot be read becomes `[REDACTED]`. Blank cells stay blank.

In Advanced mode the same menu appears on every column. "Bulk apply" sets one
policy on all columns, on the columns you tick, or only on the columns still on
Keep. Each column also has a role (Identifier, Quasi-identifier, Sensitive or
Other), which the app uses to suggest a policy. The guesses come from the header
names, so check them, especially for columns with unusual names.

## 5. Advanced mode: passphrase, salt and download

Open Advanced mode at `/advanced`, or follow the link from Simple mode. Its
sidebar has three pages: Dashboard, Preview and Certificate.

1. **Load a file** under "Source File", or click a demo file.
2. **Set a policy for each column** in the grid, one at a time or in bulk.
3. **Enter a passphrase** under "Keyed Hashing", then press the key button
   ("Derive session key from passphrase"). The browser derives a key from the
   passphrase with Argon2id, and the status shows "Keyed session active". The
   passphrase stays in your browser. To end the session, clear it. Hash then
   falls back to unkeyed SHA-256.
4. **Optionally set a dataset name** under "Run options". The name is mixed into
   the key, so two datasets never share tokens, even with the same passphrase and
   salt. Use the same name again if you want the same tokens later.
5. **Check the Preview.** It shows the original and the anonymised data side by
   side.
6. **Press "Process & Download".** The output downloads as
   `anonymized-<original name>`. The audit log appears in the Status card and,
   while a passphrase session is active, so does the salt file
   (`anonymized-<original name>.salt`).
7. **Open Certificate** if you want a record of the run.

About the salt. Each keyed session creates a new random 32-byte salt. The same
passphrase, salt, dataset and options give the same tokens, in the browser and in
the command-line tool. The browser cannot import a salt file, so each run makes a
new one. To reproduce or extend a run, give the saved salt file to the
command-line tool.

Keep the passphrase and the salt file apart from the output you share. Together
they recreate every token, and with Encrypt they also decrypt the cells. If you
lose either one, the tokens cannot be reproduced, and the ciphertext cannot be
decrypted.

## 6. Optional: a measured release

Advanced mode has an "Anonymous release" switch in the anonymity check panel. It
allows only policies that cannot be linked back (keep, redact, mask, year, age
band and number range). It then checks the output file itself: every combination
of the quasi-identifier columns you chose must be shared by at least k rows
(k-anonymity, default k=5). Rows in smaller groups have their cells replaced with
`*`, or are dropped. The app exports the file only if the check passes.

The check describes one file. It says nothing about linkage with other data, about
free text, about columns you did not mark, or about whether the sensitive values in
a group are all the same. Small files may not reach k at all. The "(why?)" link
next to the download explains these limits in plain terms.

## 7. The command-line tool

The command-line tool, `anonymiser`, does the same job for CSV, TSV and JSONL
files of any size. It does not read Excel or ODS files. Build it with Rust 1.89 or
later:

```bash
cargo build --release -p anonymiser-cli     # binary: target/release/anonymiser
target/release/anonymiser --help
```

The demo files are in `frontend/public/samples/`, so the customers file can be
used directly from the repository root:

```bash
target/release/anonymiser anonymise frontend/public/samples/customers.csv customers-out.csv \
  --columns name,email,phone --policy redact --oneshot --no-manifest
```

This redacts the three listed columns and keeps the rest. The tool prints the
pseudonymisation notice and a line for each column's policy. `--oneshot` uses a
new random salt that is never saved, so the output cannot be reproduced or joined
with other runs. Leave it out if you want a reproducible run.

Some points that match the app:

- The tool refuses to run without `--columns`, `--policy-file` or `--all-columns`.
  A missing flag never means "everything". Columns you do not list are kept.
- `--policy` takes `hash` (the default), `redact`, `mask`, `faux`, `year`,
  `age-band` and `bucket` (a number range), and `encrypt`. `age-band` needs
  `--reference-date YYYY-MM-DD`. `--width N` sets the band or range width.
- For keyed tokens, use `--passphrase`, and pair it with `--salt-file` to reuse the
  salt you saved in the browser. A passphrase typed on the command line can stay
  in your shell history and in process lists. Prefer `--master-key-file` where you
  can.
- Without `--passphrase`, the tool uses a master key file, `master_key.bin` by
  default. It creates the file in the current folder if it is missing. Keep it
  private, and do not share it with the output.
- `--force` overwrites an existing output file. Without it, the tool refuses.
- `--policy-file policy.json` reads a policy file of the kind the app exports. It
  cannot be combined with `--columns` or `--policy`.
- `anonymiser verify` checks an output file against its run record and reports
  personal-data hints in the columns that were kept.
- The app's Dataset, Token encoding and Anonymous release settings have CLI
  equivalents: `--dataset`, `--token-encoding hex|base32`, and
  `--quasi-identifiers` with `--min-group`.

Run `anonymiser <command> --help` for the full list of options.
