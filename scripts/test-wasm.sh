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
export CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="${FLAGS[*]:-}"

RUNNER="${WASM_BINDGEN_TEST_RUNNER:-wasm-bindgen-test-runner}"
if ! command -v "$RUNNER" >/dev/null 2>&1 && [ -x "$HOME/.cargo/bin/wasm-bindgen-test-runner" ]; then
    RUNNER="$HOME/.cargo/bin/wasm-bindgen-test-runner"
fi
ACTUAL=$("$RUNNER" --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
if [ "$PINNED" != "$ACTUAL" ]; then
    echo "wasm-bindgen-test-runner $ACTUAL != crate pin $PINNED." >&2
    echo "Fix: cargo install wasm-bindgen-cli --version $PINNED --locked" >&2
    exit 1
fi
export CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER="$RUNNER"

cargo test -p anonymiser-wasm --locked --target wasm32-unknown-unknown --lib "$@"
