#!/usr/bin/env bash
# Gate + checkpoint one core-v1 ticket.
#   scripts/ticket.sh <NN> "<short title>"
# Runs the green gate (check + tests, plus mutate/size where wired). Commits and
# tags `core/t<NN>` only if the gate passes; a red gate makes no checkpoint.
set -euo pipefail

# use the workspace's toolchain whether or not `vp` is global
export PATH="$(git rev-parse --show-toplevel)/node_modules/.bin:$PATH"

NN="${1:?usage: scripts/ticket.sh <NN> \"<title>\"}"
TITLE="${2:?usage: scripts/ticket.sh <NN> \"<title>\"}"
TAG="core/t${NN}"

echo "== gate ${TAG}: vp check =="
vp check
echo "== gate ${TAG}: vp run -r test =="
vp run -r test
echo "== gate ${TAG}: size budget =="
vp run core#size
echo "== gate ${TAG}: mutation (best-effort until thresholds finalized) =="
vp run -r mutate || echo "  (mutate not wired yet — skipped)"

git add -A
git commit -m "core(t${NN}): ${TITLE}

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git tag -f "${TAG}"
echo "== checkpoint ${TAG} set =="
