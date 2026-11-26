# Third-party licenses

Summary of the licenses of the dependencies that ship with Spreadsheet Anonymiser 0.0.7. The project itself is licensed under the GNU Affero General Public License, version 3 or later (see [LICENSE](LICENSE)). The licences listed below are all permissive and can be combined with it; their notices stay with the code.

**Copyleft check: no GPL, AGPL, LGPL or MPL obligation applies to the Rust and npm dependencies that ship (the container base layer is covered in [Container image](#container-image-base-layer)).** One dependency offers a copyleft licence only as one option of a multiple licence, and permissive options are available (see [Dual-licensed with a copyleft option](#dual-licensed-with-a-copyleft-option)). Every npm package that ships declares a licence.

## How this was generated

`bash scripts/third-party-licenses.sh` regenerates the dependency sections of this file offline and deterministically, from the lockfiles. Run it after any dependency change and commit the result; `--check` fails if the file is stale.

- **Rust:** `cargo metadata --format-version 1 --locked`, following only normal (non-dev, non-build) dependency edges from `anonymiser-cli` and `anonymiser-wasm`. Workspace crates are excluded. The `license` field of each `Cargo.toml` is reported as published.
- **Frontend:** the production tree of `frontend/package-lock.json` (entries marked `dev` or `devOptional` are skipped), with the `license` field the lockfile records from each package's `package.json`. `UNKNOWN` means the package declares none.

The lists cover everything reachable from the production dependencies, which is a superset of what the browser bundle actually contains (for example, code that only runs under Node). Development and build tools (Vite, TypeScript, ESLint, Vitest, Tailwind, and so on) are not shipped and are not listed. The sections after the two dependency lists are written by hand and are not touched by the script, which only warns when a package with a copyleft or missing licence is not mentioned in them. This file is a summary of declared metadata, not legal advice.

## Rust crates (119 packages in the CLI and WASM graph)

| License (SPDX expression, as declared) | Count |
|---|---|
| `MIT OR Apache-2.0` | 77 |
| `Apache-2.0 OR MIT` | 24 |
| `MIT` | 6 |
| `Unlicense OR MIT` | 5 |
| `(MIT OR Apache-2.0) AND Unicode-3.0` | 2 |
| `Unlicense/MIT` | 2 |
| `Apache-2.0 OR BSL-1.0` | 1 |
| `MIT OR Apache-2.0 OR LGPL-2.1-or-later` | 1 |
| `Zlib OR Apache-2.0 OR MIT` | 1 |

### `MIT OR Apache-2.0` (77)

aead@0.6.1, aes@0.9.4, anstream@1.0.0, anstyle-parse@1.0.0, anstyle-query@1.1.5, anstyle-wincon@3.0.11, anstyle@1.0.14, anyhow@1.0.104, argon2@0.6.0, base64@0.23.1, blake2@0.11.0, block-buffer@0.12.1, bumpalo@3.20.3, cfg-if@1.0.5, chacha20@0.10.2, cipher@0.5.2, clap@4.6.7, clap_builder@4.6.7, clap_derive@4.6.7, clap_lex@1.1.1, colorchoice@1.0.5, cpubits@0.1.1, cpufeatures@0.3.1, crypto-common@0.2.2, ctr@0.10.1, digest@0.11.3, futures-core@0.3.34, futures-task@0.3.34, futures-util@0.3.34, getrandom@0.4.3, hashbrown@0.17.1, heck@0.5.0, hex@0.4.3, hkdf@0.13.0, hmac@0.13.0, hybrid-array@0.4.15, inout@0.2.6, is_terminal_polyfill@1.70.2, itoa@1.0.19, js-sys@0.3.107, libc@0.2.191, log@0.4.35, num-traits@0.2.19, once_cell_polyfill@1.70.2, password-hash@0.6.1, pbkdf2@0.13.0, proc-macro2@1.0.107, quote@1.0.47, rand_core@0.10.1, regex-automata@0.4.18, regex-syntax@0.8.11, regex@1.13.1, serde@1.0.229, serde_core@1.0.229, serde_derive@1.0.229, serde_json@1.0.154, serde_spanned@1.1.3, sha2@0.11.1, sha3@0.12.0, shake@0.1.0, sponge-cursor@0.1.0, syn@2.0.119, syn@3.0.10, thiserror-impl@2.0.21, thiserror@2.0.21, toml@1.2.1+spec-1.1.0, toml_datetime@1.1.3+spec-1.1.0, toml_parser@1.1.5+spec-1.1.0, toml_writer@1.2.0+spec-1.1.0, typenum@1.20.1, universal-hash@0.6.1, wasm-bindgen-macro-support@0.2.130, wasm-bindgen-macro@0.2.130, wasm-bindgen-shared@0.2.130, wasm-bindgen@0.2.130, windows-link@0.2.1, windows-sys@0.61.2

### `Apache-2.0 OR MIT` (24)

aes-gcm@0.11.1, base64ct@1.8.3, chacha20poly1305@0.11.0, cmov@0.5.4, const-oid@0.10.3, ctutils@0.4.8, der@0.8.3, equivalent@1.0.3, ghash@0.6.0, indexmap@2.14.2, keccak@0.2.2, kem@0.3.0, ml-kem@0.3.4, module-lattice@0.2.4, phc@0.6.1, pin-project-lite@0.2.17, pkcs8@0.11.0, poly1305@0.9.1, polyval@0.7.3, portable-atomic-util@0.2.8, portable-atomic@1.15.0, spki@0.8.1, utf8parse@0.2.2, zeroize@1.9.1

### `MIT` (6)

data-encoding@2.11.1, libm@0.2.16, slab@0.4.12, strsim@0.11.1, winnow@1.0.5, zmij@1.0.23

### `Unlicense OR MIT` (5)

aho-corasick@1.1.5, jiff-core@0.1.4, jiff-static@0.2.42, jiff@0.2.42, memchr@2.8.3

### `(MIT OR Apache-2.0) AND Unicode-3.0` (2)

unicode-ident@1.0.27, unicode-normalization@0.1.26

### `Unlicense/MIT` (2)

csv-core@0.1.13, csv@1.4.0

### `Apache-2.0 OR BSL-1.0` (1)

ryu@1.0.23

### `MIT OR Apache-2.0 OR LGPL-2.1-or-later` (1)

r-efi@6.0.0

### `Zlib OR Apache-2.0 OR MIT` (1)

tinyvec@1.13.3

## Frontend production dependencies (17 packages)

| License (as declared) | Count |
|---|---|
| `MIT` | 15 |
| `Apache-2.0` | 1 |
| `ISC` | 1 |

### `MIT` (15)

See `frontend/package-lock.json` for the full list; every package in this group is permissively licensed.

### `Apache-2.0` (1)

comlink@4.4.2

### `ISC` (1)

lucide-react@1.71.0

## Dual-licensed with a copyleft option

- **`r-efi@6.0.0`** (Rust, UEFI targets only; pulled in by `getrandom` and not compiled for Linux, macOS, Windows or wasm32): `MIT OR Apache-2.0 OR LGPL-2.1-or-later`. We use it under MIT or Apache-2.0.

## Licence notices

If you redistribute this software: MIT, BSD, ISC and Apache-2.0 require that the copyright and permission notice travel with copies. Keep this file and `LICENSE` with every copy; the individual notices are in each package's source.

## Container image (base layer)

The hosted image (`docker/Dockerfile`) copies the built web bundle onto `nginxinc/nginx-unprivileged:1.30.6-alpine-slim`: nginx 1.30.6 (BSD-2-Clause) on Alpine Linux 3.24 (musl libc MIT, OpenSSL 3 Apache-2.0, zlib, PCRE2 BSD-3-Clause, and busybox, which is GPL-2.0-only). The scan above covers the Rust and npm graphs only; the base layer is upstream's, unmodified apart from our nginx configuration files, and its package sources are available from Alpine.

## Fonts and other assets

The web app ships no third-party fonts or logos.
