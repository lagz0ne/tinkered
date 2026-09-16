#!/usr/bin/env bash
# Gate + checkpoint one react-v1 ticket.
#   scripts/ticket-react.sh <NN> "<short title>"
# Runs the green gate (check + tests, plus size where wired). Commits and tags
# `react/r<NN>` only if the gate passes; a red gate makes no checkpoint.
set -euo pipefail

# use the workspace's toolchain whether or not `vp` is global
export PATH="$(git rev-parse --show-toplevel)/node_modules/.bin:$PATH"

# browser-mode tests (ADR 0033) need the sandbox's Playwright runtime env + cached
# browsers when present; harmless elsewhere.
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
if [ -f "$HOME/.cache/ms-playwright/browser-env.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cache/ms-playwright/browser-env.sh"
fi

NN="${1:?usage: scripts/ticket-react.sh <NN> \"<title>\"}"
TITLE="${2:?usage: scripts/ticket-react.sh <NN> \"<title>\"}"
TAG="react/r${NN}"

echo "== gate ${TAG}: vp check =="
vp check
echo "== gate ${TAG}: build core dist (react tests load @tinker/core from dist) =="
vp run core#build
echo "== gate ${TAG}: vp run -r test =="
vp run -r test
echo "== gate ${TAG}: size budget =="
vp run react#size

git add -A
git commit -m "react(r${NN}): ${TITLE}

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git tag -f "${TAG}"
echo "== checkpoint ${TAG} set =="
