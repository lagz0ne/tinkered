#!/usr/bin/env bash
# Pack the two base releases the proof uses, from the repo root:
# This is the 0.1.x proof. Rerun it at its own commit, d524069f:
# git worktree add ../tinkered-0.1 d524069f. The tree is 0.2.0 now.
# 0.1.1 is the tree; 0.1.0 is the tree minus release-0.1.1.patch.
set -euo pipefail
base=poc/start-base
rm -rf "$base/packs"
node "$base/scripts/pack.mjs"
git apply -R poc/scripts/release-0.1.1.patch
trap 'git checkout -- "$base/package.json" "$base/UPGRADE.md" "$base/src/routes/api.health.ts"' EXIT
node "$base/scripts/pack.mjs"
ls -l "$base/packs"
