#!/usr/bin/env bash
# Catch up with main: fetch, rebase on origin/main, then install and build again.
#   scripts/worktree-sync.sh
# Stops on a dirty tree (commit first; never stash) and on a detached HEAD
# (a pinned tree, such as a bench base, stays on its commit).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "worktree-sync: uncommitted changes. Commit first; never stash."
  exit 1
fi
if ! git symbolic-ref -q HEAD >/dev/null; then
  echo "worktree-sync: detached HEAD is a pinned tree; it stays on its commit."
  exit 1
fi
git fetch origin
git rebase origin/main
scripts/worktree-setup.sh
