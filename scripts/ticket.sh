#!/usr/bin/env bash
# Gate + checkpoint one ticket, in core or a named package.
#   scripts/ticket.sh <NN> "<short title>"              (core: tag core/t<NN>)
#   scripts/ticket.sh <pkg> <NN> "<short title>"        (package: tag pkg/t<NN>)
# Runs the green gate (check + tests + size + the named package's mutate lane). Commits and
# tags only if the gate passes; a red gate makes no checkpoint.
set -euo pipefail

# use the workspace's toolchain whether or not `vp` is global
export PATH="$(git rev-parse --show-toplevel)/node_modules/.bin:$PATH"

no_mutation=0
check_only=0
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --no-mutation) no_mutation=1 ;;
    --check-only) check_only=1 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

if [ $# -eq 3 ]; then
  PKG="$1"
  NN="$2"
  TITLE="$3"
elif [ $# -eq 2 ]; then
  PKG="core"
  NN="$1"
  TITLE="$2"
else
  echo 'usage: scripts/ticket.sh [<pkg>] <NN> "<title>"' >&2
  exit 1
fi
if [[ ! "$NN" =~ ^[0-9]+$ ]]; then
  echo "ticket NN must be a number, got: '${NN}'" >&2
  exit 1
fi
TAG="${PKG}/t${NN}"

# Advisory pre-read (ADR: docs/roadmap/jev-loop/PLAN.md): Jev flags anti-goals and routes
# attention. NEVER blocks the gate (|| true) and is NOT the source of truth — the gate below is.
echo "== ${TAG}: jev review (advisory) =="
node tools/jev/review.mjs HEAD || true
# Impact chain pre-read (ADR 0047): the plan's blast radius vs SCIP refs, one Jev
# boolean per discrepancy. NEVER blocks (|| true) — advisory only, like review.mjs.
node tools/jev/impact.mjs "${TAG}" || true

echo "== gate ${TAG}: vp check =="
vp check
echo "== gate ${TAG}: vp run -r test =="
vp run -r test
# core/size-build: the build renames Core's private fields, so Core's tests also run on the
# built files, with the rename guard's tests.
if [ "$PKG" = "core" ]; then
  echo "== gate ${TAG}: core tests on the built files =="
  vp run core#test:dist
fi
# `vp run <pkg>#<task>` exits 0 and runs nothing when no package has that name.
# `--fail-if-no-match -F <pkg>` exits 1 instead, so a typo cannot pass the gate.
echo "== gate ${TAG}: size budget =="
vp run --fail-if-no-match -F "${PKG}" size
if (( no_mutation )); then
  echo "== gate ${TAG}: mutation skipped by request =="
else
  echo "== gate ${TAG}: mutation (${PKG} only) =="
  vp run --fail-if-no-match -F "${PKG}" mutate
fi

if (( check_only )); then
  echo "== gate ${TAG}: checks pass; no checkpoint requested =="
  exit 0
fi

git add -A
git commit -m "${PKG}(t${NN}): ${TITLE}

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git tag -f "${TAG}"
echo "== checkpoint ${TAG} set =="
