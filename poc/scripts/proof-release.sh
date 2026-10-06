#!/usr/bin/env bash
# The release half of the POC proof (ADR 0106), from the repo root.
# This is the 0.1.x proof. Rerun it at its own commit, d524069f:
# git worktree add ../tinkered-0.1 d524069f. The tree is 0.2.0 now.
# Installs the packed 0.1.0 base, breaks the app 4 ways, upgrades to 0.1.1,
# then puts app-min back on the workspace link. Logs land in poc/proof/.
# Needs both packs: node poc/start-base/scripts/pack.mjs (see PROOF.md).
set -uo pipefail
repo=$(pwd)
app=poc/app-min
out=$repo/poc/proof
mkdir -p "$out"
clean() { sed -e "s|$repo/||g" -e "s|$HOME|~|g"; }
pin() {
  node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));
    p.dependencies["@tinker/start"]=process.argv[1];
    fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n");' "$1"
}
say() { echo "\$ $*"; }
doctor() {
  say "tinker doctor $*"
  npx --no tinker doctor "$@"
  echo "EXIT $?"
}
install() { (cd "$repo" && vp install > /dev/null 2>&1; echo "vp install: EXIT $?"); }
chunks() {
  say "grep filePath/preloads dist/server/assets/_tanstack-start-manifest*.js"
  grep -E "filePath|preloads" dist/server/assets/_tanstack-start-manifest_v-*.js
}
build() {
  rm -rf dist
  vp build > /tmp/tinker-build.log 2>&1
  echo "vp build: EXIT $?"
  grep "dist/client/assets" /tmp/tinker-build.log
}

git checkout "$app/package.json" pnpm-lock.yaml
cd "$app"
rm -rf "$repo"/node_modules/.pnpm/@tinker+start@file+*

{
  say "pin @tinker/start to the packed 0.1.0 release"
  pin "file:../start-base/packs/tinker-start-0.1.0.tgz"
  install
  echo "base folder: $(readlink -f node_modules/@tinker/start)"
  build
  chunks
  "$repo/poc/scripts/curl-app.sh" .
  doctor
} 2>&1 | clean > "$out/1-release-0.1.0.txt"

{
  say 'sed -i "s/Tinker base/My base/" node_modules/@tinker/start/src/routes/tinker.tsx'
  sed -i "s/Tinker base/My base/" node_modules/@tinker/start/src/routes/tinker.tsx
  doctor
  doctor --fix
  say 'grep -c "Tinker base" node_modules/@tinker/start/src/routes/tinker.tsx'
  grep -c "Tinker base" node_modules/@tinker/start/src/routes/tinker.tsx
} 2>&1 | clean > "$out/2-break-base-file.txt"

{
  say "rm -rf .tinker"
  rm -rf .tinker
  doctor
  doctor --fix
  say "ls .tinker"
  ls .tinker
} 2>&1 | clean > "$out/3-break-generated.txt"

{
  printf '%s\n' \
    'import { responseBodies } from "@tinker/start/src/backend/body.server.ts";' \
    'import { requestStop } from "../../node_modules/@tinker/start/src/backend/lifetime.ts";' \
    'export const peek = [responseBodies, requestStop];' > src/backend/peek.ts
  say "cat src/backend/peek.ts"
  cat src/backend/peek.ts
  doctor
  doctor --fix
  say "rm src/backend/peek.ts"
  rm src/backend/peek.ts
  doctor
} 2>&1 | clean > "$out/4-break-import.txt"

{
  cp tsconfig.json /tmp/tinker-tsconfig.json
  say 'echo "{}" > tsconfig.json'
  echo "{}" > tsconfig.json
  doctor
  doctor --fix
  say "cat tsconfig.json"
  cat tsconfig.json
  cp /tmp/tinker-tsconfig.json tsconfig.json
} 2>&1 | clean > "$out/5-break-tsconfig.txt"

{
  (cd src && find . -type f | sort | xargs sha256sum) > /tmp/tinker-src-before.txt
  say "tinker upgrade 0.1.1 --from ../start-base/packs"
  npx --no tinker upgrade 0.1.1 --from ../start-base/packs 2>&1 | grep -v "^Progress\|^Packages\|^+*$\|Update available\|Changelog\|self-update"
  echo "EXIT ${PIPESTATUS[0]}"
  say "cat .tinker/base.json"
  cat .tinker/base.json
  (cd src && find . -type f | sort | xargs sha256sum) > /tmp/tinker-src-after.txt
  say "diff src hashes before and after"
  diff /tmp/tinker-src-before.txt /tmp/tinker-src-after.txt && echo "src/: no change"
  say "git status --short $app"
  git -C "$repo" status --short "$app"
  say "git diff $app/src"
  git -C "$repo" diff --exit-code "$app/src" && echo "(empty)"
  say "git diff $app/package.json"
  git -C "$repo" diff "$app/package.json"
  build
  "$repo/poc/scripts/curl-app.sh" .
} 2>&1 | clean > "$out/6-upgrade.txt"

{
  say "git checkout $app/package.json pnpm-lock.yaml"
  git -C "$repo" checkout "$app/package.json" pnpm-lock.yaml
  rm -rf "$repo"/node_modules/.pnpm/@tinker+start@file+*
  install
  echo "base folder: $(readlink -f node_modules/@tinker/start)"
  build
  chunks
  "$repo/poc/scripts/curl-app.sh" .
  doctor
  say "vp run typecheck"
  vp run typecheck > /tmp/tinker-typecheck.log 2>&1
  echo "EXIT $?"
} 2>&1 | clean > "$out/7-workspace-link.txt"

grep -H "EXIT\|^fail\|^fixed\|^skip\|doctor:" "$out"/*.txt | cut -c1-120
