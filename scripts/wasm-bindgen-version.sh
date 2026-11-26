#!/usr/bin/env bash
set -euo pipefail

MANIFEST="$(dirname "$0")/../crates/anonymiser-wasm/Cargo.toml"
VERSION=$(sed -n 's/^wasm-bindgen[[:space:]]*=[[:space:]]*"=\([0-9][0-9.]*\)".*/\1/p' "$MANIFEST")
if [ -z "$VERSION" ]; then
    echo "no exact wasm-bindgen pin (wasm-bindgen = \"=x.y.z\") in $MANIFEST" >&2
    exit 1
fi
echo "$VERSION"
