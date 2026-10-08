#!/usr/bin/env bash
# Make a worktree ready to work in: install, then build (apps import the packages' built dist).
#   scripts/worktree-setup.sh
# Runs on its own for every new worktree: the post-checkout hook and Paseo's worktree setup
# both call it. Skip the hook's run with TINKER_SETUP=0 (a tree you only read).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
vp=$(command -v vp || echo "$HOME/.local/vp/bin/vp")
echo "worktree-setup: $(pwd)"
"$vp" install
"$vp" run -r build
echo "worktree-setup: ready"
