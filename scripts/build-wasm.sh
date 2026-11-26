#!/usr/bin/env bash
set -euo pipefail

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
PINNED=$(bash "$SCRIPTS/wasm-bindgen-version.sh")
cd "$SCRIPTS/../crates/anonymiser-wasm"

SYSROOT="${RUST_WASM_SYSROOT:-}"
if [ -z "$SYSROOT" ] && [ -d "$HOME/rust-wasm-sysroot/lib/rustlib/wasm32-unknown-unknown" ]; then
    SYSROOT="$HOME/rust-wasm-sysroot"
fi

FLAGS=()
if [ -n "$SYSROOT" ]; then
    FLAGS+=(--sysroot="$SYSROOT")
fi

RUSTFLAGS="${FLAGS[*]:-}" cargo build --release --locked --target wasm32-unknown-unknown

CARGO_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"
if [ -z "${WASM_BINDGEN:-}" ] && ! command -v wasm-bindgen >/dev/null 2>&1 && [ -x "$CARGO_BINDGEN" ]; then
    WASM_BINDGEN="$CARGO_BINDGEN"
fi

BINDGEN="${WASM_BINDGEN:-wasm-bindgen}"

# INVARIANT: the wasm-bindgen CLI must match the crate pin. A mismatched CLI
# emits a wasm/glue pair that compiles fine and breaks in the browser with an ABI error.
ACTUAL=$("$BINDGEN" --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
if [ "$PINNED" != "$ACTUAL" ]; then
    echo "wasm-bindgen CLI $ACTUAL != crate pin $PINNED." >&2
    echo "Fix: cargo install wasm-bindgen-cli --version $PINNED --locked" >&2
    exit 1
fi

"$BINDGEN" --target web \
    --out-dir ../../frontend/src/wasm-pkg \
    ../../target/wasm32-unknown-unknown/release/anonymiser_wasm.wasm

echo "wasm package written to frontend/src/wasm-pkg"
