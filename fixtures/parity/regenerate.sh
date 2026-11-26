#!/usr/bin/env bash
# INVARIANT: Only re-run (and commit the result) when the CLI's I/O or hashing is
# intentionally changed; the test failing otherwise means the browser path
# drifted from the CLI. Never regenerate to make a parity test pass.
set -euo pipefail
cd "$(dirname "$0")/../.."

work="$(mktemp -d)"
trap 'rm -rf "${work:?}"' EXIT
for i in $(seq 0 31); do printf "\\x$(printf %02x "$i")"; done > "$work/salt.bin"

run() {
    local in="$1" out="$2"
    shift 2
    cargo run -q -p anonymiser-cli --locked -- anonymise "$in" "$out" \
        --passphrase parity-passphrase --salt-file "$work/salt.bin" \
        --dataset parity --policy-file fixtures/parity/policy.json --force --no-manifest "$@"
}

run fixtures/parity/people.csv fixtures/parity/people.expected.csv
run fixtures/parity/people.tsv fixtures/parity/people.expected.tsv --token-encoding base32
run fixtures/parity/people.jsonl fixtures/parity/people.expected.jsonl

arun() {
    local in="$1" out="$2"
    shift 2
    cargo run -q -p anonymiser-cli --locked -- anonymise "$in" "$out" \
        --passphrase parity-passphrase --salt-file "$work/salt.bin" \
        --dataset parity --policy-file fixtures/parity/anonymity-policy.json \
        --reference-date 2026-01-01 --quasi-identifiers dob,city --min-group 2 \
        --force --no-manifest "$@"
}
arun fixtures/parity/anonymity.csv fixtures/parity/anonymity.expected.cells.csv --suppress cells
arun fixtures/parity/anonymity.csv fixtures/parity/anonymity.expected.rows.csv --suppress rows
arun fixtures/parity/anonymity.excluded-input.csv fixtures/parity/anonymity.expected.excluded-cells.csv --suppress cells
arun fixtures/parity/anonymity.excluded-input.csv fixtures/parity/anonymity.expected.excluded-rows.csv --suppress rows
echo "regenerated fixtures/parity/people.expected.* and fixtures/parity/anonymity.expected.*"
