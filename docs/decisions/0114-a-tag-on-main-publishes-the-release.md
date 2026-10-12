# 0114 A tag on main publishes the release

Date: 2026-10-12. Status: proposed.

- User, 2026-10-12: "We don't want to use normal way
  of distribution but rather strictly via github
  release, and that'll make us moving fast (and we
  care about our stuff only)."

Builds on: 0074, 0106.
Replaces: ADR 0074's "published to npm" step.

## Context

ADR 0106 ships Core, React, and Start as one set.
The set is three tarballs on one GitHub release.
An app's `package.json` names each tarball's URL.
`tinker upgrade <version>` rewrites the three URLs.

- `start-v0.7.0` went out on 2026-10-07.
- A person ran `gh release` by hand.
- `scripts/release.mjs` packs; it has no publish mode.
- Main is 50 commits past 0.7.0; no app can get them.

## Precedent

- **Go modules.** A git tag is the version.
  There is no registry to publish to.
- **npm URL dependencies.** npm and pnpm install
  a `.tgz` from any HTTPS URL. The lockfile keeps
  its integrity hash.
- **Tag-triggered release workflows.** A pushed
  tag starts a job that packs and uploads.
  The job uses its own `GITHUB_TOKEN`.
- **GitHub immutable releases** (GA 2025-10-28).
  Once published, assets cannot change.
  The tag cannot move or be deleted.
  GitHub's order: draft, attach, publish.

Ours is simpler than npm: no scope, no account,
no token on any box, one name (the tag) per set.

## Decision

1. The only way out is a GitHub release.
   No npm, no GitHub Packages, no other registry.
2. `node scripts/bump.mjs <version>` moves the three
   packages, Start's tested versions, and the
   registry links to one version.
3. The lead adds the version's `UPGRADE.md` section
   and lands the bump on main like any card.
4. The lead pushes tag `start-v<version>` on main.
5. `.github/workflows/release.yml` then:
   - refuses a tag that is not on main;
   - packs with `scripts/release.mjs`;
   - runs `scripts/release-check.mjs`:
     versions, notes, and the committed registry
     must all match the tag;
   - drafts the release, attaches the tarballs
     and `manifest.json`, then publishes;
   - downloads the tarballs and matches sha256.
6. The release notes are the `UPGRADE.md` section.

## Consequences

- A release is one tag push; no one runs `gh`.
- The registry is read from the tag over
  `raw.githubusercontent.com`. The check makes
  sure the tag's registry names its own tarballs.
- `.github/workflows/ci.yml` runs build, check,
  tests and prose on every PR and push to main.
  The release job runs no tests; CI already did.
- Mutation and timing stay on the bench box.
  They need its quiet core.
- Immutable releases are a repository setting.
  Only the owner can turn them on.
