#!/usr/bin/env bash
# The two-hands gate (ADR 0051): `Scope.Handle` may appear only in a composition root
# (a file that calls `createScope`, or a test), in `@tinkered/core` and `@tinkered/react`
# (they define or provide it), or in a driver's src: a capsule that owns sessions and hands
# them to its handlers (`@tinkered/bun`'s serve and ws, `@tinkered/entry`'s routes, and an
# app's copy of those routes). A page's route table is its router's root: the router
# context carries the scope, as `client/App.tsx` did in the first version of this gate
# (Duke, 2026-11-22: option A). Anywhere else — an app module, an example, a package that
# is not a driver — is a leak. Prints the offending lines; exit 1 on any.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
allowed='^(packages/(core|react|bun|entry)/src/|packages/[^/]+/tests/|tools/blueprint/tests/|apps/[^/]+/tests/|apps/[^/]+/src/routes\.tsx$|apps/[^/]+/tinker/components/requests/)'
hits=$(git ls-files --cached --others --exclude-standard 'tools/blueprint/*.ts' 'apps/*.ts' 'apps/*.tsx' 'examples/*.ts' 'examples/*.tsx' 'packages/*.ts' 'packages/*.tsx' \
  | grep -vE "$allowed" \
  | xargs grep -L "createScope(" 2>/dev/null \
  | xargs grep -n "Scope\.Handle" 2>/dev/null || true)
if [ -n "$hits" ]; then
  echo "two-hands: Scope.Handle outside a root, a defining package, a driver, or a test:"
  echo "$hits"
  exit 1
fi
echo "two-hands: clean"
