# 0146 Release to npm by trusted publishing

Date: 2026-11-12. Status: accepted (Duke, 03:58:
"yeah, let's do that").
Changes: ADR 0114 (GitHub release only).
Keeps: ADR 0122 (one tag, one version).

## What the user said

Duke, 03:50: "what would be a fastest way to
release those libraries, maybe to npm or jsr or
keep current as github release? it takes too
much effort to use npm actually".

## Context

Publishing was already zero steps: a bump on
green main made the GitHub release.

The work came after that, in each app:

- tinker-app: 3 tarball URLs to edit by hand.
- Hedl: 4 tarball URLs to edit by hand.
- A URL has no range, so no tool can bump it.
- TanStack Intent lists npm packages only.

The precedent is npm trusted publishing: CI
proves who it is by OIDC, and holds no token.

The npm scope `@tinker` belongs to someone else.
The scope `@tinkered` was free.

## Decision

1. **New names.** `@tinker/x` is now
   `@tinkered/x`, for core, react, bun, analyze.
   An npm alias would keep the old import name,
   but then React pulls a second Core.
2. **Two tarballs per package.** The GitHub one
   names its siblings by release URL, as before.
   The npm one names them by `^version`.
3. **npm job.** After the GitHub release, a job
   on a GitHub-hosted runner publishes the npm
   tarballs. npm takes OIDC only from a hosted
   runner.
4. **No token.** The job has `id-token: write`
   and nothing else.
5. **One-time step.** npm sets trust per package,
   and a package must exist first.
   `scripts/npm-setup.sh` does the first publish
   and `npm trust github` for each. Duke runs it
   once, and again for a new package.
6. **Not on npm yet means skip.** The job warns
   and goes on, so main stays green before setup.

## Rejected

- **JSR:** Bun 1.4 has no `jsr:`; it needs an npm
  alias. Intent does not list it. JSR ships our
  TS source, so the size cap no longer holds.
- **pkg.pr.new:** a URL per commit, for preview.
  Apps still edit URLs.
- **GitHub Packages:** a token even to install.

## Proof

Scratch run, 2026-11-12, local npm registry:

- npm-style tarballs of v0.17.9 installed in a
  Bun 1.4.4 app; `vite build` passed.
- `bun update --latest` moved all three to
  0.17.10. One copy of Core.
