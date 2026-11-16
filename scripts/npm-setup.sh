#!/usr/bin/env bash
# One-time npm setup for the @tinkered packages (ADR 0146). Duke runs it
# once, on a laptop with an npm login that owns the "tinkered" org.
# Then CI publishes every release by OIDC, with no token. From a phone, run
# the workflow npm-first.yml instead: it does the same with a token secret.
#
#   scripts/npm-setup.sh            # the latest GitHub release
#   scripts/npm-setup.sh 0.18.0     # one release
#
# Safe to run again: it skips a package that npm has. Run it again for a new
# package. Run it in a terminal: npm prints a 2FA link for each step.
#
# A package that npm has got its trust at its first publish. npm 12 asks for
# 2FA to read a trust list, so the script does not check it again.
set -euo pipefail

REPO=lagz0ne/tinkered
WORKFLOW=release.yml
PACKAGES=(core react bun cli entry)
NPM="npx --yes npm@12.2.2"

VERSION=${1:-$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
  sed -nE 's/.*"tag_name": *"v([0-9.]+)".*/\1/p')}
echo "Release v$VERSION"

# Not in the repo: its package.json pins pnpm, and npm stops on that.
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT
cd "$DIR"

$NPM whoami >/dev/null 2>&1 || $NPM login
echo "npm user: $($NPM whoami)"

for p in "${PACKAGES[@]}"; do
  name="@tinkered/$p"
  file="npm-tinkered-$p-$VERSION.tgz"

  if $NPM view "$name" name >/dev/null 2>&1; then
    echo "$name: on npm already"
    continue
  fi

  curl -fsSL -o "$DIR/$file" \
    "https://github.com/$REPO/releases/download/v$VERSION/$file"
  $NPM publish "$DIR/$file" --access public
  echo "$name: first publish done"

  trust=($NPM trust github "$name" --repo "$REPO" --file "$WORKFLOW" --allow-publish --yes)
  if ! "${trust[@]}"; then
    # The package is on npm now, so a second run skips it: set the trust by hand.
    echo "$name: trust NOT set. Run in this folder: ${trust[*]}" >&2
    exit 1
  fi
  echo "$name: trust set"
done

echo "Done. CI publishes the next release to npm by itself."
