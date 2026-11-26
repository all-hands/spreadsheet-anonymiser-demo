# Spreadsheet Anonymiser

Pseudonymises tabular files with a policy per column: keyed tokens, masks,
fakes, generalisation (year, age band, bucket) or encryption. One Rust core
drives two fronts that give byte-identical output for the same key, salt and
options:

- a **browser app** for `.csv`, `.tsv`, `.jsonl`, `.xlsx` and `.ods` files.
  All processing happens on your device, in a Web Worker running WebAssembly.
  No file or passphrase is sent anywhere; the server only serves static files.
- a **command-line tool** (`anonymiser`) that streams `.csv`, `.tsv` and
  `.jsonl` files of any size.

> **Pseudonymised is not anonymous.** The output replaces the values you
> select, but it may still be personal data under the GDPR: the columns you
> leave in clear can re-identify people, small groups are easy to single out,
> and anyone holding the key and salt can recompute the tokens. Treat outputs,
> keys and salt files as sensitive.

## Run the web app

```bash
docker compose up --build      # or: podman compose up --build
```

Then open <http://localhost:8000>. The app includes five fictional demo files.
A step-by-step guide to the app and the command-line tool is in
[USER_GUIDE.md](USER_GUIDE.md).

## Build from source

You need Rust 1.89 or later with the `wasm32-unknown-unknown` target, the
`wasm-bindgen` CLI at the version `bash scripts/wasm-bindgen-version.sh`
prints, and Node.js 24 or later.

```bash
bash scripts/build-wasm.sh              # writes frontend/src/wasm-pkg
cd frontend && npm ci && npm run dev    # development server
```

The command-line tool:

```bash
cargo run -p anonymiser-cli -- --help
cargo run -p anonymiser-cli -- anonymise fixtures/members.csv out.csv \
    --columns member_id --policy hash
cargo run -p anonymiser-cli -- inspect fixtures/members.csv --columns member_id
```

## Tests

```bash
cargo test --workspace
bash scripts/test-wasm.sh
cd frontend && npm run lint && npx tsc -b && npx vitest run
```

## About this repository

This repository is a one-way export of the project's working repository; each
export replaces the one before it, so `main` holds a single commit. Changes are
made upstream, so pull requests here are not merged. Bug reports are welcome as
issues. Report a vulnerability privately: see [SECURITY.md](SECURITY.md).

## Licence

Copyright (C) 2026 Spreadsheet Anonymiser contributors.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version. It comes with no warranty. See [LICENSE](LICENSE); the licences
of the dependencies are summarised in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

If you run a modified version as a network service, the licence requires you
to offer its users the source of that version.
