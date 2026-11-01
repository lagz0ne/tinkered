# 0122 Start is sunset; Core and React release alone

Date: 2026-11-01. Status: accepted.
Accepted: Duke, 2026-11-01 11:33 UTC:
"We can sunset the start".
Supersedes: the tag part of 0114; the Start-base
parts of 0106. Those files stay as written.

## What the user said

- 11:33: "We can sunset the start"
- 12:00: the `tinker add` and `tinker update` CLI
  goes too: "the current authoring is way better
  and simpler".

## Words

- **Start**: the Start base (`packages/start`,
  `@tinker/start`), its apps (`apps/start-min`,
  `apps/start-scaffold`), the `tinker` CLI, and
  the Start registry and template.
- **sunset**: the code leaves main; what was
  already released stays.

Core's own `start` hook is not Start. It stays.

## Precedent

- **npm deprecate.** A package is marked end of
  life. Its published versions stay installable.
  Nothing is unpublished.
- **The `request` package** (deprecated 2020).
  New work moved to other clients. Old installs
  kept working from the same versions.

Where ours is simpler:

- No deprecation window. Start leaves main in
  one change.
- One git tag freezes the code: `start-archive`.

## Decision

### 1. Start is removed

These leave main:

- `packages/start`;
- `apps/start-min` and `apps/start-scaffold`;
- the `tinker` CLI: `add`, `update`, `upgrade`,
  `doctor`, `serve`;
- the Start registry.

The code lives on in the annotated tag
`start-archive` (commit `5a9f13a9`).

### 2. Apps come from tinker-app

- Apps are built from `lagz0ne/tinker-app`.
- It is a TanStack Router SPA on Bun, v0.18.0.
- It needs only `@tinker/core` and
  `@tinker/react`.

### 3. Old releases stay

- Every `start-v*` release and tag stays.
- `start-v0.10.0` tarball URLs keep working.
  Hedl and the template pin them.

### 4. Release from now on

- Core and React release alone, in lockstep.
- The version source is
  `packages/core/package.json`.
- The tag is `vX.Y.Z`.
- The assets keep their old names:
  - `tinker-core-X.Y.Z.tgz`;
  - `tinker-react-X.Y.Z.tgz`.
- The notes are the root `CHANGELOG.md`
  section `## X.Y.Z`.
- The first one is `v0.10.1`.

This replaces the `start-v<version>` tag of
0114, step 5. The GitHub-release-only rule of
0114 stays.

## Consequences

- Main has two libraries and no Start tests,
  benches, or trial suite on the Start base.
- The writer trial's Flight suite goes with
  the base it grew.
- A check that used a Start app as its fixture
  now uses a kept one: the lazy-module check
  reads the examples and React; the F13 client
  check builds the playground.
- An app on `start-v0.10.0` keeps working. To
  move on, it ports to `tinker-app`.
- ADR files that link into the removed folders
  keep their dead links. A decision changes only
  by a new decision.
