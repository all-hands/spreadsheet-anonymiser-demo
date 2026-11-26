#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

MODE="write"
case "${1:-}" in
    "") ;;
    --check) MODE="check" ;;
    -h|--help)
        cat <<'EOF'
Regenerate the dependency sections of THIRD_PARTY_LICENSES.md from the lockfiles.

  bash scripts/third-party-licenses.sh           # rewrite THIRD_PARTY_LICENSES.md
  bash scripts/third-party-licenses.sh --check   # exit 1 if the file is out of date

--check only compares and changes nothing.
EOF
        exit 0
        ;;
    *)
        echo "usage: $0 [--check | --help]" >&2
        exit 2
        ;;
esac

mkdir -p target
META=$(mktemp "target/licenses-metadata.XXXXXX")
trap 'rm -f "$META"' EXIT
if ! cargo metadata --format-version 1 --locked --offline >"$META" 2>/dev/null; then
    cargo metadata --format-version 1 --locked >"$META"
fi

THIRD_PARTY_MODE="$MODE" THIRD_PARTY_META="$META" python3 -I - <<'PY'
import collections
import json
import os
import re
import sys

MODE = os.environ["THIRD_PARTY_MODE"]
OUT = "THIRD_PARTY_LICENSES.md"
ROOTS = ("anonymiser-cli", "anonymiser-wasm")

meta = json.load(open(os.environ["THIRD_PARTY_META"]))
by_id = {p["id"]: p for p in meta["packages"]}
workspace = set(meta["workspace_members"])

# --- Rust: normal (non-dev, non-build) edges reachable from the shipped crates.
roots = [i for i in workspace if by_id[i]["name"] in ROOTS]
if len(roots) != len(ROOTS):
    sys.exit("expected workspace crates %s" % ", ".join(ROOTS))
nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
seen, stack = set(), list(roots)
while stack:
    cur = stack.pop()
    if cur in seen:
        continue
    seen.add(cur)
    for dep in nodes[cur]["deps"]:
        if any(k["kind"] is None for k in dep["dep_kinds"]):
            stack.append(dep["pkg"])
rust = sorted(
    {
        (by_id[i]["name"] + "@" + by_id[i]["version"], by_id[i].get("license") or "UNKNOWN")
        for i in seen
        if i not in workspace
    }
)
version = by_id[roots[0]]["version"]

# --- Frontend: production tree of package-lock.json (`dev` and `devOptional`
# entries are only reachable from development dependencies).
lock = json.load(open("frontend/package-lock.json"))
web = sorted(
    {
        (path.split("node_modules/")[-1] + "@" + p["version"], p.get("license") or "UNKNOWN")
        for path, p in lock["packages"].items()
        if path and not p.get("dev") and not p.get("devOptional")
    }
)


def groups(pkgs):
    by = collections.defaultdict(list)
    for name, lic in pkgs:
        by[lic].append(name)
    # most common first, then by licence string, so ties are stable
    return sorted(by.items(), key=lambda kv: (-len(kv[1]), kv[0]))


def render(title, pkgs, header, collapse_mit):
    out = ["## " + title % len(pkgs), "", "| %s | Count |" % header, "|---|---|"]
    gs = groups(pkgs)
    for lic, names in gs:
        out.append("| `%s` | %d |" % (lic, len(names)))
    out.append("")
    for lic, names in gs:
        out.append("### `%s` (%d)" % (lic, len(names)))
        out.append("")
        if collapse_mit and lic == "MIT":
            out.append(
                "See `frontend/package-lock.json` for the full list; every package in this group is permissively licensed."
            )
        else:
            out.append(", ".join(sorted(names)))
        out.append("")
    return "\n".join(out)


HOW = """## How this was generated

`bash scripts/third-party-licenses.sh` regenerates the dependency sections of this file offline and deterministically, from the lockfiles. Run it after any dependency change and commit the result; `--check` fails if the file is stale.

- **Rust:** `cargo metadata --format-version 1 --locked`, following only normal (non-dev, non-build) dependency edges from `anonymiser-cli` and `anonymiser-wasm`. Workspace crates are excluded. The `license` field of each `Cargo.toml` is reported as published.
- **Frontend:** the production tree of `frontend/package-lock.json` (entries marked `dev` or `devOptional` are skipped), with the `license` field the lockfile records from each package's `package.json`. `UNKNOWN` means the package declares none.

The lists cover everything reachable from the production dependencies, which is a superset of what the browser bundle actually contains (for example, code that only runs under Node). Development and build tools (Vite, TypeScript, ESLint, Vitest, Tailwind, and so on) are not shipped and are not listed. The sections after the two dependency lists are written by hand and are not touched by the script, which only warns when a package with a copyleft or missing licence is not mentioned in them. This file is a summary of declared metadata, not legal advice.
"""

text = open(OUT).read()


new = text
new = re.sub(
    r"(that ship with Spreadsheet Anonymiser )\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?(?=\.\s)",
    lambda m: m.group(1) + version,
    new,
    count=1,
)


def replace(src, start, end, body):
    a = src.index(start)
    b = src.index(end, a)
    return src[:a] + body + "\n" + src[b:]


new = replace(new, "## How this was generated", "## Rust crates", HOW)
new = replace(
    new,
    "## Rust crates",
    "## Frontend production dependencies",
    render("Rust crates (%d packages in the CLI and WASM graph)", rust, "License (SPDX expression, as declared)", False),
)
new = replace(
    new,
    "## Frontend production dependencies",
    "## Dual-licensed with a copyleft option",
    render("Frontend production dependencies (%d packages)", web, "License (as declared)", True),
)

# --- Warn about copyleft or unknown licences the hand-written text ignores.
a = new.index("## Dual-licensed with a copyleft option")
editorial = new[a:]
flagged = [
    (n, l)
    for n, l in rust + web
    if re.search(r"GPL|MPL|EUPL|SSPL|CC-BY-SA|UNKNOWN|UNLICENSED|SEE LICENSE", l)
]
missing = [(n, l) for n, l in flagged if n not in editorial]
for n, l in missing:
    sys.stderr.write(
        "warning: %s (%s) is not discussed under 'Dual-licensed' or 'Licence notices' in %s\n" % (n, l, OUT)
    )

if MODE == "check":
    if new != text:
        sys.stderr.write("%s is out of date: run bash scripts/third-party-licenses.sh\n" % OUT)
        sys.exit(1)
    print("%s is up to date" % OUT)
else:
    if new != text:
        open(OUT, "w").write(new)
        print("rewrote %s (%d Rust crates, %d npm packages)" % (OUT, len(rust), len(web)))
    else:
        print("%s already up to date" % OUT)
PY
