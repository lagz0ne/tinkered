#!/usr/bin/env bash
# SCIP code navigation for the workspace (indexes are gitignored under .scip/).
#   scripts/scip.sh index [pkg ...]          build .scip/<pkg>.scip for the given (default: all) packages
#   scripts/scip.sh refs '<regex>' [pkg ...] definitions + per-file reference counts of symbols matching regex
#   scripts/scip.sh symbols '<regex>' [pkg]  distinct symbol strings matching regex (to learn the naming)
# Symbol strings look like: `.../Scope/Handle#typeLiteral144:run().` — match with e.g. 'Handle#\w+:run\(\)\.$'
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
export PATH="/home/paseo/.local/share/pnpm/bin:/home/paseo/.local/bin:$ROOT/node_modules/.bin:$PATH"
mkdir -p "$ROOT/.scip"

cmd="${1:?usage: scripts/scip.sh index|refs|symbols ...}"
shift

all_pkgs() { for d in "$ROOT"/packages/*/; do basename "$d"; done; }

case "$cmd" in
  index)
    pkgs=("$@"); [ ${#pkgs[@]} -eq 0 ] && mapfile -t pkgs < <(all_pkgs)
    for p in "${pkgs[@]}"; do
      (cd "$ROOT/packages/$p" && scip-typescript index --output "$ROOT/.scip/$p.scip" >/dev/null 2>&1 \
        && echo "indexed $p -> .scip/$p.scip" || echo "FAILED $p (run scip-typescript index in packages/$p to see why)")
    done
    ;;
  refs|symbols)
    regex="${1:?usage: scripts/scip.sh $cmd '<regex>' [pkg ...]}"; shift
    pkgs=("$@"); [ ${#pkgs[@]} -eq 0 ] && mapfile -t pkgs < <(all_pkgs)
    for p in "${pkgs[@]}"; do
      idx="$ROOT/.scip/$p.scip"
      [ -f "$idx" ] || { echo "== $p: no index (run scripts/scip.sh index $p)"; continue; }
      echo "== $p"
      scip print --json "$idx" 2>/dev/null | python3 "$ROOT/scripts/scip-refs.py" "$cmd" "$regex"
    done
    ;;
  *) echo "unknown command: $cmd" >&2; exit 2 ;;
esac
