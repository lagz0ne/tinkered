# 0116 Items join the app through a generated seam

Date: 2026-10-13. Status: proposed.
Builds on: 0106, 0107, 0112, 0113, 0115.

## Context and precedent

Registry items need to join Start without a hand edit.
The user owns `src/lib/tinker.server.ts` and `src/lib/tinker.ts`.
Prepare must never write either file.

Use a generated index, as TanStack Router writes `routeTree.gen.ts`.
Prepare already writes `.tinker/parts.ts` with explicit imports.
Use declaration merging, which adds fields to an open type,
as the app already fills Start's `Register` interface.

The lead's plan is `/home/paseo/plans/registry-composition.md`,
section 2, "Self-join".
Probe numbers below count that section's probe bullets from one.

- Probe 5: the generated shape passed tsc and build.
  It added 108 server bytes and 2 client bytes.
- Probe 6: a wrong typed tag value failed tsc.
  A glob accepted `42` in settings without a local check.
- Probe 7: a glob lost the sync change union.
  The generated tuple refused an unknown change kind.

## Decision

- Items write `src/joins/<item>.join.server.ts`
  and `src/joins/<item>.join.ts`.
- Each exports `needs` as a literal list of item names.
  Dependencies run first; ties use file-name order.
  A dependency without a join contributes no entries.
  A cycle or a nonliteral list stops prepare.
- Prepare writes `.tinker/app.server.ts` and `.tinker/app.ts`.
  Each join has one eager namespace import.
  The user's seam comes last, or the existing empty default.
- Server `extensions` and `settings`, and client `extensions`,
  join lists in needs order, then the user's list.
  Settings readers receive env and return `Tag.Bindings`.
  A typed reader alias also lets a zero-argument reader work.
- Single names keep one join owner.
  The user's seam wins over that owner.
  Two join owners fail prepare and doctor with both paths,
  even when the user also exports the name.
- Type-only checks reject wrong exports without widening
  a join's inferred types or its sync unions.
- Both `#tinker/app` aliases point at the generated files.
  Base parts keep their existing imports.
- Server joins keep `.server.` in their names.
  Start's existing client import protection still applies.
- Adding or removing a join restarts dev.
  Prepare runs at install, build, and dev start as before.
- With no joins, a generated file re-exports the existing seam.
  This keeps its exports and avoids a new list or settings call.

Outside values still enter through settings at the seam (0113).
Items import their own files by path (0112).
They load outside libraries through declared deps (0107).

## Deferred work

TODO: sync slices and per-item `nav` belong to plan card 4.
Part switches and splitting the existing registry block belong
on later cards.
This card changes neither.
