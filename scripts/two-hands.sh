#!/usr/bin/env bash
# The two-hands gate (ADR 0051): `Scope.Handle` may appear only in a composition root
# (a file that calls `createScope`, or a test), in `@tinker/core` and `@tinker/react` (they define
# and provide it), and inside a driver package's `src` (its `start` hand and the private
# helpers that hand feeds). Anywhere else — an app module, an example, a package that is
# not a driver — is a leak. Prints the offending lines; exit 1 on any.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
allowed='^(packages/(core|react|hono|cli|mcp|sync|harness|drizzle|http)/src/|packages/[^/]+/tests/|apps/[^/]+/tests/|apps/[^/]+/src/client/App\.tsx$)'
hits=$(git ls-files 'apps/*.ts' 'apps/*.tsx' 'examples/*.ts' 'examples/*.tsx' 'packages/*.ts' 'packages/*.tsx' \
  | grep -vE "$allowed" \
  | xargs grep -L "createScope(" 2>/dev/null \
  | xargs grep -n "Scope\.Handle" 2>/dev/null || true)
if [ -n "$hits" ]; then
  echo "two-hands: Scope.Handle outside a root, a driver's src, or a test:"
  echo "$hits"
  exit 1
fi
echo "two-hands: clean"
