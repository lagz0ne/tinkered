#!/usr/bin/env bash
set -euo pipefail
# Check if autoresearch runtime state is gitignored, prompt to add if not.
# Usage: bash setup-gitignore.sh [project_root]

ROOT="${1:-.}"
GITIGNORE="${ROOT}/.gitignore"

ENTRIES=(
  ".autoresearch/"
)

missing=()
for entry in "${ENTRIES[@]}"; do
  if [ -f "$GITIGNORE" ] && grep -qxF "$entry" "$GITIGNORE" 2>/dev/null; then
    continue
  fi
  missing+=("$entry")
done

if [ ${#missing[@]} -eq 0 ]; then
  echo "OK: autoresearch runtime state already in .gitignore"
  exit 0
fi

echo "The following autoresearch runtime entries are not in .gitignore:"
for m in "${missing[@]}"; do
  echo "  $m"
done

printf "\nAdd them to %s? [y/N] " "$GITIGNORE"
read -r answer
if [[ "$answer" =~ ^[Yy]$ ]]; then
  [ -f "$GITIGNORE" ] && [ -s "$GITIGNORE" ] && [[ $(tail -c1 "$GITIGNORE") != "" ]] && echo >> "$GITIGNORE"
  echo "# autoresearch runtime state" >> "$GITIGNORE"
  for m in "${missing[@]}"; do
    echo "$m" >> "$GITIGNORE"
  done
  echo "Added ${#missing[@]} entries to $GITIGNORE"
else
  echo "Skipped. You can add them manually later."
fi
