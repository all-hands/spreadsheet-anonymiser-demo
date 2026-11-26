#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Smoke test for the hosted container (unprivileged nginx serving frontend/dist).

  scripts/smoke-container.sh <base-url> [image]

  <base-url>  where the container listens, e.g. http://127.0.0.1:8000
  [image]     image reference; when given, the image's configured user is
              checked too (needs `podman` or `docker` on PATH)

Environment:
  SMOKE_ENGINE     "podman" or "docker" for the image check (default: whichever
                   of the two holds the image)
  SMOKE_CURL_ARGS  extra curl arguments, space separated (e.g. "-k" for a
                   self-signed certificate when testing through a TLS proxy)
EOF
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
esac
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage >&2
  exit 2
fi
BASE="${1%/}"
IMAGE="${2:-}"

# shellcheck disable=SC2206 # word splitting of SMOKE_CURL_ARGS is intended
CURL_EXTRA=(${SMOKE_CURL_ARGS:-})

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK:?}"' EXIT

FAILURES=0
CHECKS=0

# SECURITY: The CSP below is fixed. Changing it is a deliberate security decision:
# update this constant and docker/nginx/security-headers.conf together.
EXPECTED_CSP="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; style-src 'self'; img-src 'self' data: blob:; worker-src 'self'; frame-ancestors 'none';"
EXPECTED_HSTS="max-age=31536000; includeSubDomains"

fail() {
  FAILURES=$((FAILURES + 1))
  echo "FAIL: $*" >&2
}

check() {
  local description="$1"
  shift
  CHECKS=$((CHECKS + 1))
  if ! "$@" >/dev/null 2>&1; then
    fail "$description"
  fi
}

STATUS=""
request() {
  local method="$1" path="$2"
  shift 2
  : >"$WORK/headers"
  : >"$WORK/body"
  local method_args=(-X "$method")
  if [ "$method" = "HEAD" ]; then
    method_args=(--head)
  fi
  STATUS="$(curl -sS --path-as-is --max-time 15 "${CURL_EXTRA[@]}" "${method_args[@]}" \
    -D "$WORK/headers" -o "$WORK/body" -w '%{http_code}' "$@" "$BASE$path" 2>"$WORK/curl.err")" || {
    fail "$method $path: curl failed: $(cat "$WORK/curl.err")"
    STATUS="000"
  }
}

header() {
  local name="$1"
  awk -v n="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" '
    { line = $0; sub(/\r$/, "", line); i = index(line, ":"); if (i == 0) next
      k = tolower(substr(line, 1, i - 1))
      if (k == n) { v = substr(line, i + 1); sub(/^[ \t]+/, "", v); last = v } }
    END { print last }' "$WORK/headers"
}

header_count() {
  awk -v n="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" '
    { line = $0; sub(/\r$/, "", line); i = index(line, ":"); if (i == 0) next
      if (tolower(substr(line, 1, i - 1)) == n) c++ }
    END { print c + 0 }' "$WORK/headers"
}

body_has() { grep -qF -- "$1" "$WORK/body"; }
body_lacks() { ! grep -qiE -- "$1" "$WORK/body"; }

ct_matches() {
  local ct pattern
  ct="$(header content-type)"
  for pattern in "$@"; do
    # shellcheck disable=SC2053 # the pattern is meant to be a glob
    [[ "$ct" == $pattern ]] && return 0
  done
  return 1
}
is_html() { ct_matches 'text/html*'; }
is_js() { ct_matches 'text/javascript*' 'application/javascript*'; }

head_body_is_empty() {
  local hostport host port reply rest
  case "$BASE" in http://*) ;; *) return 0 ;; esac
  hostport="${BASE#http://}"
  hostport="${hostport%%/*}"
  host="${hostport%%:*}"
  port="${hostport##*:}"
  if [ "$port" = "$hostport" ]; then port=80; fi
  exec 3<>"/dev/tcp/$host/$port"
  printf 'HEAD %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n' "$1" "$hostport" >&3
  reply="$(timeout 10 cat <&3; printf x)"
  exec 3<&- 3>&-
  rest="${reply#*$'\r\n\r\n'}"
  [ "$rest" = "x" ]
}

expect_status() {
  CHECKS=$((CHECKS + 1))
  if [ "$STATUS" != "$2" ]; then fail "$1: expected HTTP $2, got $STATUS"; fi
}

expect_header() {
  CHECKS=$((CHECKS + 1))
  local got
  got="$(header "$2")"
  if [ "$got" != "$3" ]; then fail "$1: header $2 expected '$3', got '$got'"; fi
}

expect_security_headers() {
  local h
  for h in content-security-policy x-content-type-options x-frame-options strict-transport-security referrer-policy; do
    CHECKS=$((CHECKS + 1))
    if [ "$(header_count "$h")" != "1" ]; then fail "$1: header $h must appear exactly once, found $(header_count "$h")"; fi
  done
  expect_header "$1" content-security-policy "$EXPECTED_CSP"
  expect_header "$1" x-content-type-options "nosniff"
  expect_header "$1" x-frame-options "DENY"
  expect_header "$1" strict-transport-security "$EXPECTED_HSTS"
  expect_header "$1" referrer-policy "no-referrer"
}

ready=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "${CURL_EXTRA[@]}" -o /dev/null "$BASE/healthz" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "FAIL: $BASE/healthz did not answer 200 within 30 s" >&2
  exit 1
fi

request GET /sw.js
SW_TEXT="$(cat "$WORK/body")"
ASSET_JS="$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' <<<"$SW_TEXT" | head -n1 || true)"
ASSET_WASM="$(grep -oE 'assets/[A-Za-z0-9_.-]+\.wasm' <<<"$SW_TEXT" | head -n1 || true)"
ASSET_WORKER="$(grep -oE 'assets/processing\.worker-[A-Za-z0-9_-]+\.js' <<<"$SW_TEXT" | head -n1 || true)"
ASSET_CSS="$(grep -oE 'assets/[A-Za-z0-9_.-]+\.css' <<<"$SW_TEXT" | head -n1 || true)"
[ -n "$ASSET_JS" ] || fail "could not find an assets/index-*.js entry in /sw.js precache manifest"
[ -n "$ASSET_WASM" ] || fail "could not find a .wasm asset in /sw.js precache manifest"
[ -n "$ASSET_WORKER" ] || fail "could not find assets/processing.worker-*.js in /sw.js precache manifest"
[ -n "$ASSET_CSS" ] || fail "could not find a .css asset in /sw.js precache manifest"
ASSET_JS="/${ASSET_JS:-assets/missing.js}"
ASSET_WASM="/${ASSET_WASM:-assets/missing.wasm}"
ASSET_WORKER="/${ASSET_WORKER:-assets/missing-worker.js}"
ASSET_CSS="/${ASSET_CSS:-assets/missing.css}"

request GET /healthz
expect_status "GET /healthz" 200
check "GET /healthz body is 'ok'" test "$(tr -d '\r\n' <"$WORK/body")" = "ok"
expect_security_headers "GET /healthz"

request GET /
expect_status "GET / (also a valid health path)" 200

request GET /advanced
expect_status "SPA fallback GET /advanced" 200
check "SPA fallback body contains 'root'" body_has "root"
check "SPA fallback body contains 'html'" body_has "html"
check "SPA fallback content-type is text/html" is_html
expect_header "SPA fallback cache" cache-control "no-cache"
for p in /simple /advanced/certificate /some/deep/route/ /icons/; do
  request GET "$p"
  expect_status "SPA fallback GET $p" 200
  check "SPA fallback GET $p is html" is_html
done
request GET /50x.html
expect_status "GET /50x.html falls back to the SPA shell" 200
check "GET /50x.html is the SPA shell, not the nginx stock page" body_has "root"
request GET /
check "GET / content-type is text/html" is_html
expect_header "GET / cache" cache-control "no-cache"

request GET "$ASSET_JS"
expect_status "GET $ASSET_JS" 200
check "GET $ASSET_JS body is not the SPA shell" body_lacks '<!doctype html'
check "GET $ASSET_JS content-type is JavaScript" is_js
expect_header "GET $ASSET_JS cache" cache-control "public, max-age=31536000, immutable"

request GET "$ASSET_CSS"
expect_status "GET $ASSET_CSS" 200
check "GET $ASSET_CSS content-type is text/css" ct_matches 'text/css*'

request GET "$ASSET_WORKER"
expect_status "GET $ASSET_WORKER" 200
check "worker $ASSET_WORKER served as JavaScript" is_js
expect_security_headers "GET $ASSET_WORKER"

request GET "$ASSET_WASM"
expect_status "GET $ASSET_WASM" 200
WASM_TYPE="$(header content-type)"
check "wasm content-type is application/wasm (instantiateStreaming needs it), got '$WASM_TYPE'" \
  test "${WASM_TYPE%%;*}" = "application/wasm"
check "wasm body starts with the \\0asm magic" \
  test "$(head -c 4 "$WORK/body" | od -An -tx1 | tr -d ' \n')" = "0061736d"
expect_header "GET $ASSET_WASM cache" cache-control "public, max-age=31536000, immutable"

for p in "$ASSET_WASM" "$ASSET_WORKER"; do
  request GET "$p" -H 'Accept-Encoding: gzip'
  expect_status "GET $p (gzip)" 200
  expect_header "GET $p (gzip)" content-encoding "gzip"
  check "GET $p (gzip): Vary names Accept-Encoding, got '$(header vary)'" \
    grep -qi 'accept-encoding' <<<"$(header vary)"
  expect_security_headers "GET $p (gzip)"
done
request GET "$ASSET_WASM" -H 'Accept-Encoding: gzip'
check "gzip wasm content-type is still application/wasm" \
  test "$(header content-type | cut -d';' -f1)" = "application/wasm"

for p in /sw.js /registerSW.js /manifest.webmanifest /index.html; do
  request GET "$p"
  expect_status "GET $p" 200
  expect_header "GET $p cache" cache-control "no-cache"
  expect_security_headers "GET $p"
done
request GET /manifest.webmanifest
check "manifest content-type is a manifest/JSON type" ct_matches 'application/manifest+json*' 'application/json*'
request GET /sw.js
check "sw.js served as JavaScript" is_js

for p in /assets/does-not-exist-123.js /assets/nope.wasm /assets/ /assets; do
  request GET "$p"
  expect_status "missing asset GET $p" 404
  check "missing asset GET $p is not the SPA shell" body_lacks 'id=.root'
  expect_security_headers "GET $p (404)"
  CHECKS=$((CHECKS + 1))
  cc="$(header cache-control)"
  if [[ "$cc" == *immutable* ]]; then fail "404 GET $p must not be marked immutable (Cache-Control: $cc)"; fi
done
request GET /nope.png
expect_status "unknown file GET /nope.png falls back to the SPA shell" 200

for p in / "$ASSET_JS" /advanced /simple /nope.png /assets/missing.js /healthz; do
  request GET "$p"
  expect_security_headers "GET $p"
done

for p in / /advanced "$ASSET_JS" "$ASSET_WASM" /healthz; do
  request HEAD "$p"
  expect_status "HEAD $p" 200
  check "HEAD $p has an empty body" head_body_is_empty "$p"
  expect_security_headers "HEAD $p"
done
request HEAD "$ASSET_WASM"
check "HEAD wasm content-type is application/wasm" test "$(header content-type)" = "application/wasm"

TRAVERSAL_PATHS=(
  "/../../../../etc/passwd"
  "/..%2F..%2F..%2F..%2Fetc%2Fpasswd"
  "/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd"
  "/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd"
  "/..%252F..%252F..%252F..%252Fetc%252Fpasswd"
  "/assets/../../../../../etc/passwd"
  "/assets/..%2F..%2F..%2F..%2F..%2Fetc%2Fpasswd"
  "/..\\..\\..\\..\\etc\\passwd"
  "/../../../../etc/nginx/nginx.conf"
  "/..%2F..%2F..%2F..%2Fetc%2Fnginx%2Fnginx.conf"
  "/../nginx/nginx.conf"
  "/%2e%2e/%2e%2e/etc/nginx/conf.d/default.conf"
  "/..%2F..%2F..%2F..%2Fproc%2Fself%2Fenviron"
)
for p in "${TRAVERSAL_PATHS[@]}"; do
  request GET "$p"
  CHECKS=$((CHECKS + 1))
  if grep -qE 'root:[x*]?:0:0|worker_processes|server_tokens|HOSTNAME=' "$WORK/body"; then
    fail "traversal leak via $p"
  fi
  CHECKS=$((CHECKS + 1))
  case "$STATUS" in
    200) check "traversal $p: a 200 must be the SPA shell (text/html)" is_html ;;
    400 | 404) ;;
    *) fail "traversal $p: unexpected HTTP $STATUS (want 200 html, 400 or 404)" ;;
  esac
done

for method in POST PUT PATCH DELETE OPTIONS; do
  for p in / /advanced "$ASSET_JS" /healthz /upload /api/anonymise; do
    request "$method" "$p" --data 'a,b
1,2'
    expect_status "$method $p must be rejected" 405
    expect_header "$method $p" allow "GET, HEAD"
    expect_security_headers "$method $p (405)"
  done
done
request POST / -H 'Content-Type: multipart/form-data; boundary=x' --data-binary $'--x\r\nContent-Disposition: form-data; name="f"; filename="a.csv"\r\n\r\na,b\r\n--x--\r\n'
expect_status "multipart upload POST /" 405

request GET /
CSP="$(header content-security-policy)"
check "CSP is byte-identical to the expected policy" test "$CSP" = "$EXPECTED_CSP"
check "CSP is present" test -n "$CSP"

csp_values() {
  tr ';' '\n' <<<"$CSP" | awk -v d="$1" '{ if ($1 == d) { for (i = 2; i <= NF; i++) print $i } }'
}
check "CSP connect-src is exactly 'self'" test "$(csp_values connect-src | tr '\n' ' ')" = "'self' "
check "CSP default-src is exactly 'self'" test "$(csp_values default-src | tr '\n' ' ')" = "'self' "
check "CSP worker-src is exactly 'self'" test "$(csp_values worker-src | tr '\n' ' ')" = "'self' "
check "CSP frame-ancestors is exactly 'none'" test "$(csp_values frame-ancestors | tr '\n' ' ')" = "'none' "
csp_has() { csp_values "$1" | grep -qxF -- "$2"; }
csp_external() { csp_values "$1" | grep -qE '^(http:|https:|ws:|wss:|\*)'; }
check "CSP script-src allows 'wasm-unsafe-eval'" csp_has script-src "'wasm-unsafe-eval'"
CHECKS=$((CHECKS + 1))
if csp_has script-src "'unsafe-eval'"; then fail "CSP script-src must not allow 'unsafe-eval'"; fi
CHECKS=$((CHECKS + 1))
if csp_external connect-src; then fail "CSP connect-src has an external host (http:, https:, ws:, wss: or *)"; fi
CHECKS=$((CHECKS + 1))
if grep -iqE "connect-src[^;]*(https?:|wss?:|\*)" <<<"$CSP"; then fail "CSP connect-src must not allow external hosts"; fi
CHECKS=$((CHECKS + 1))
if grep -qE "(^|[[:space:]])(https?:|wss?:|\*)" <<<"${CSP//;/ }"; then fail "CSP must contain no external host or wildcard anywhere"; fi

for p in / /simple /advanced/certificate "$ASSET_JS" /nope.png /assets/missing.js; do
  request GET "$p"
  got="$(header content-security-policy)"
  CHECKS=$((CHECKS + 1))
  if [[ "$got" == *unsafe-inline* ]]; then fail "GET $p: CSP contains 'unsafe-inline'"; fi
  CHECKS=$((CHECKS + 1))
  style="$(tr ';' '\n' <<<"$got" | awk '$1 == "style-src" { for (i = 2; i <= NF; i++) printf "%s ", $i }')"
  if [ "$style" != "'self' " ]; then fail "GET $p: style-src expected exactly 'self', got '$style'"; fi
done

request GET /
SERVER="$(header server)"
CHECKS=$((CHECKS + 1))
if [[ "$SERVER" =~ [0-9] ]]; then fail "Server header leaks a version: '$SERVER' (server_tokens must be off)"; fi
request GET /healthz
expect_header "GET /healthz cache" cache-control "no-store"

if [ -n "$IMAGE" ]; then
  engine=""
  for candidate in ${SMOKE_ENGINE:-podman docker}; do
    if command -v "$candidate" >/dev/null 2>&1 &&
      "$candidate" image inspect "$IMAGE" >/dev/null 2>&1; then
      engine="$candidate"
      break
    fi
  done
  if [ -z "$engine" ]; then
    fail "image $IMAGE not found in podman or docker (set SMOKE_ENGINE to choose one)"
  else
    user="$("$engine" image inspect -f '{{.Config.User}}' "$IMAGE" 2>/dev/null || true)"
    CHECKS=$((CHECKS + 1))
    case "$user" in
      "" | 0 | root | 0:* | root:*) fail "image $IMAGE runs as root (Config.User='$user'); expected a non-root user" ;;
    esac
  fi
fi

if [ "$FAILURES" -ne 0 ]; then
  echo "smoke test FAILED: $FAILURES of $CHECKS checks failed against $BASE" >&2
  exit 1
fi
echo "smoke test passed: $CHECKS checks against $BASE"
