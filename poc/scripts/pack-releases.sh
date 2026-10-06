#!/usr/bin/env bash
# Pack the two base releases the proof uses, from the repo root:
# 0.1.1 is the tree; 0.1.0 is the tree minus release-0.1.1.patch.
set -euo pipefail
base=poc/start-base
rm -rf "$base/packs"
node "$base/scripts/pack.mjs"
git apply -R poc/scripts/release-0.1.1.patch
trap 'git checkout -- "$base/package.json" "$base/UPGRADE.md" "$base/src/routes/api.health.ts"' EXIT
node "$base/scripts/pack.mjs"
ls -l "$base/packs"
