# 0116 Items join the app by file-name convention

Date: 2026-10-13. Status: proposed.
Builds on: 0106, 0107, 0112, 0113, 0115.

## Context and precedent

Registry items need to join Start without a hand edit.
The user owns `src/lib/tinker.server.ts` and `src/lib/tinker.ts`.
Prepare must never write either file.

Follow [Next.js app-router file conventions](https://nextjs.org/docs/app/api-reference/file-conventions):
a known file name supplies a known role.
Use a generated index, as TanStack Router writes `routeTree.gen.ts`.
Prepare already writes `.tinker/parts.ts` with explicit imports.
Declaration merging adds fields to an open type;
the app already fills Start's `Register` interface this way.

The self-join probes ran on the scaffold at `f214b96e`.
These facts are kept here so the decision needs no local plan file.
Probe numbers keep their original order.

- Probe 5: the generated shape passed tsc and build.
  It added 108 server bytes and 2 client bytes.
- Probe 6: a wrong typed tag value failed tsc.
  A glob accepted `42` in settings without a local check.
- Probe 7: a glob lost the sync change union.
  The generated tuple refused an unknown change kind.

## Order matters

Core's `runStartChain` runs extensions in registration order,
first on the outside (`packages/core/src/index.ts:5343`).
`findBinding` searches from the end, so the last binding for
one tag wins (`packages/core/src/index.ts:1465`).
Items therefore need a numeric folder prefix, like migrations.
Sort by its number, then by folder name to break a tie.
The user's seam is always last.

## Decision

- Items write role files under `src/items/10-postgres/`.
  Each role has one default export.
  The walker reads only file names; other files have no role.
- Server list roles: `extensions.server.ts`, `settings.server.ts`.
  Client list role: `extensions.ts`.
- Server single roles: `database.server.ts`, `auth.server.ts`,
  `readAccount.server.ts`, `bootstrap.server.ts`.
- Client single roles: `records.ts`, `readBatch.ts`,
  `readBootstrap.ts`, `readSnapshot.ts`, `streamMessage.ts`.
- Prepare writes `.tinker/app.server.ts` and `.tinker/app.ts`.
  Each role has one default import and a typed constant.
  Shared type declarations keep the generated files short.
  `satisfies` checks single roles without widening their types.
- Lists join in numeric item order, then the user's seam.
  Settings readers receive env and return `Tag.Bindings`.
  A typed reader also lets a zero-argument reader work.
- A single role has at most one item owner.
  The user's seam wins over that owner.
  Two item owners fail prepare and doctor once with both paths,
  even when the user also exports the name.
- A user seam with unreadable star exports stops prepare.
  Doctor names the file once, under named files.
  Use named exports from packages; local star exports work.
  App aliases in local star exports remain supported.
- Both `#tinker/app` aliases point at the generated files.
  Base parts keep their existing imports.
- Server roles keep `.server.` in their names.
  Start's existing client import protection still applies.
- Adding or removing a role file restarts dev.
  Prepare runs at install, build, and dev start as before.
- With no roles, the generated file is one seam re-export.
  This keeps its exports and avoids new runtime work.

Outside values still enter through settings at the seam (0113).
Items import their own files by path (0112).
They load outside libraries through declared deps (0107).

## Deferred work

TODO: sync slices and per-item `nav` belong to plan card 4.
Part switches and splitting the existing registry block belong
on later cards. This card changes neither.
