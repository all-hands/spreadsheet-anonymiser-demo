#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  -h|--help)
    cat <<'EOF'
End-to-end CLI throughput of `anonymiser anonymise` (release build), in MB/s.

  scripts/bench-cli.sh                 # 10 MB and 100 MB inputs, 3 runs each
  SIZES_MB="10" RUNS=5 scripts/bench-cli.sh

SIZES_MB and RUNS change the input sizes and the number of runs.
EOF
    exit 0 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/target/bench"
BIN="${ROOT}/target/release/anonymiser"
SIZES_MB="${SIZES_MB:-10 100}"
RUNS="${RUNS:-3}"
mkdir -p "${OUT}"

echo "== building release CLI"
cargo build --release --locked -p anonymiser-cli --manifest-path "${ROOT}/Cargo.toml" >/dev/null

gen_csv() {
  local mb="$1" file="$2"
  [ -s "${file}" ] && return 0
  awk -v target="$((mb * 1000000))" '
    function rnd(n) { s = (s * 16807) % 2147483647; return s % n }
    BEGIN {
      s = 12345
      split("Hazel Robin Fern Wren Iris Linnet Sorrel Finch", F, " ")
      split("Dummer Notreal Placeholder Smith Testwell Oconnor Dubois Rossi", L, " ")
      split("Bristol Leeds Cardiff Glasgow York", C, " ")
      split("active inactive pending", S, " ")
      line = "id,first_name,last_name,email,phone,city,dob,iban,notes,status\n"
      printf "%s", line; bytes = length(line)
      for (i = 0; bytes < target; i++) {
        f = F[rnd(8) + 1]; l = L[rnd(8) + 1]
        line = sprintf("%d,%s,%s,%s.%s%d@example.com,+44 20%d %07d,%s,%04d-%02d-%02d,GB%025d,free text note %d about %s %s,%s\n",
          i, f, l, tolower(f), tolower(l), rnd(1000), rnd(10), rnd(10000000),
          C[rnd(5) + 1], 1950 + rnd(55), 1 + rnd(12), 1 + rnd(28), rnd(1000000000),
          rnd(5000), f, l, S[rnd(3) + 1])
        printf "%s", line; bytes += length(line)
      }
    }' >"${file}"
}

write_policy() {
  local name="$1" action="$2"; shift 2
  local cols=("$@") first=1
  {
    printf '{"version":1,"columns":['
    for c in "${cols[@]}"; do
      [ "${first}" = 1 ] || printf ','
      first=0
      printf '{"name":"%s","action":"%s"}' "${c}" "${action}"
    done
    printf ']}\n'
  } >"${OUT}/policy-${name}.json"
}
write_policy keep-heavy  hash    email
write_policy hash-heavy  hash    first_name last_name email phone city dob iban
write_policy encrypt-heavy encrypt first_name last_name email phone city dob iban

KEY="${OUT}/bench_master_key.bin"
rm -f "${KEY}"

run_cmd() {
  "${BIN}" anonymise "$1" "$3" --policy-file "$2" --master-key-file "${KEY}" \
    --oneshot --force >/dev/null 2>&1
}

printf '\n%-10s %-15s %10s %10s %10s\n' size mix "bytes" "mean s" "MB/s"
for mb in ${SIZES_MB}; do
  csv="${OUT}/synthetic-${mb}mb.csv"
  gen_csv "${mb}" "${csv}"
  bytes=$(wc -c <"${csv}")
  for mix in keep-heavy hash-heavy encrypt-heavy; do
    pol="${OUT}/policy-${mix}.json"; dst="${OUT}/out-${mix}.csv"
    run_cmd "${csv}" "${pol}" "${dst}"
    if command -v hyperfine >/dev/null 2>&1; then
      hyperfine --runs "${RUNS}" --warmup 0 --export-csv "${OUT}/hf.csv" \
        "${BIN} anonymise ${csv} ${dst} --policy-file ${pol} --master-key-file ${KEY} --oneshot --force" \
        >/dev/null
      mean=$(awk -F, 'NR==2{print $2}' "${OUT}/hf.csv")
    else
      total=0
      for _ in $(seq "${RUNS}"); do
        t0=${EPOCHREALTIME/./}
        run_cmd "${csv}" "${pol}" "${dst}"
        t1=${EPOCHREALTIME/./}
        total=$((total + t1 - t0))
      done
      mean=$(awk -v t="${total}" -v n="${RUNS}" 'BEGIN{printf "%.4f", t / n / 1e6}')
    fi
    awk -v s="${mb}MB" -v m="${mix}" -v b="${bytes}" -v t="${mean}" \
      'BEGIN{printf "%-10s %-15s %10d %10.3f %10.1f\n", s, m, b, t, b / 1e6 / t}'
  done
done
