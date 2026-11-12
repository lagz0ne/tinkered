#!/usr/bin/env bash
# One-time npm setup for the @tinkered packages (ADR 0146). Duke runs it
# once, on a laptop with an npm login that owns the "tinkered" org.
# Then CI publishes every release by OIDC, with no token.
#
#   scripts/npm-setup.sh            # the latest GitHub release
#   scripts/npm-setup.sh 0.18.0     # one release
#
# Safe to run again: it skips what is done. Run it again for a new package.
set -euo pipefail

REPO=lagz0ne/tinkered
WORKFLOW=release.yml
PACKAGES=(core react bun analyze)
NPM="npx --yes npm@12.2.2"

VERSION=${1:-$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
  sed -nE 's/.*"tag_name": *"v([0-9.]+)".*/\1/p')}
echo "Release v$VERSION"

$NPM whoami >/dev/null 2>&1 || $NPM login
echo "npm user: $($NPM whoami)"

DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT

for p in "${PACKAGES[@]}"; do
  name="@tinkered/$p"
  file="npm-tinkered-$p-$VERSION.tgz"

  if $NPM view "$name" name >/dev/null 2>&1; then
    echo "$name: on npm already"
  else
    curl -fsSL -o "$DIR/$file" \
      "https://github.com/$REPO/releases/download/v$VERSION/$file"
    $NPM publish "$DIR/$file" --access public
    echo "$name: first publish done"
  fi

  if $NPM trust list "$name" 2>/dev/null | grep -q "$REPO"; then
    echo "$name: trust set already"
  else
    $NPM trust github "$name" --repo "$REPO" --file "$WORKFLOW" --allow-publish --yes
    echo "$name: trust set"
  fi
done

echo "Done. CI publishes the next release to npm by itself."
