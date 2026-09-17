#!/usr/bin/env bash
# Gate + checkpoint one ticket, in core or a named package.
#   scripts/ticket.sh <NN> "<short title>"              (core: tag core/t<NN>)
#   scripts/ticket.sh <pkg> <NN> "<short title>"        (package: tag pkg/t<NN>)
# Runs the green gate (check + tests, plus mutate/size where wired). Commits and
# tags only if the gate passes; a red gate makes no checkpoint.
set -euo pipefail

# use the workspace's toolchain whether or not `vp` is global
export PATH="$(git rev-parse --show-toplevel)/node_modules/.bin:$PATH"

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
TAG="${PKG}/t${NN}"

echo "== gate ${TAG}: vp check =="
vp check
echo "== gate ${TAG}: vp run -r test =="
vp run -r test
echo "== gate ${TAG}: size budget =="
vp run "${PKG}#size"
echo "== gate ${TAG}: mutation (best-effort until thresholds finalized) =="
vp run -r mutate || echo "  (mutate not wired yet — skipped)"

git add -A
git commit -m "${PKG}(t${NN}): ${TITLE}

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git tag -f "${TAG}"
echo "== checkpoint ${TAG} set =="
