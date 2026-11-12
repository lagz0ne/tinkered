# 0143 Skills ship in the package; Intent carries them

Date: 2026-11-12. Status: accepted (Duke, 03:18:
"i say yes, then we can make use of that if
that's not tied to only tanstack"); built for
Core and React.
Adds to: ADR 0129 (the code is the map).

## What the user said

Duke, 03:08: "learn from tanstack and how they
are delivering the skill/ instruction to work
with library. we'll want to have the same
(especially to our current ai-first toolkit) and
we are able to deliver that (skill and tool for
verification)".

## Context

Before this decision, an agent learned Tinker
from three places.

1. **The guide.** Ten pages, served as
   `/llms.txt`. The agent must know the address.
   The text has no tie to the installed version.
2. **App copies.** Hedl holds six skills in
   `.agents/skills/tinker-*`. The template holds
   none. Nothing checks a copy against Core.
3. **Checks.** Each rule has a check, but a
   failed check does not name what to read.

## Precedent

- **TanStack Intent** (`@tanstack/intent`). A CLI
  for any library. Skills are files in the npm
  package, in the Agent Skills format
  (agentskills.io). Router, DB and Start ship
  them. We read its code at 0.5.6.
- **Rust doctest, `compile_fail`.** An example in
  the docs is compiled. A wrong example is
  marked, and must fail. Intent's `validate` does
  the same with `expect-error`.
- **ESLint rule ids.** A finding prints
  `plugin/rule`, and the id finds the rule's
  page. Our lint already prints
  `tinker/cell-write`.

Intent's trust model names six stages: available,
permitted, loaded, delivered, activated, applied.
It can see the first four. It says that it cannot
see if the code obeys the skill. Our checks can.

## Decision

1. **A skill is a file in its package.**
   `packages/<pkg>/skills/<lib>/SKILL.md` is the
   entry. It sends the agent to one task skill in
   `skills/<lib>/<task>/SKILL.md`. The files ship
   in the release tarball (`files`), so a skill
   has the version of the code it teaches.
2. **Intent carries them.** We write no carrier.
   An app lists and loads skills with
   `intent list` and `intent load`. The keyword
   `tanstack-intent` marks the package.
3. **`intent validate` is a gate.** `vp run
skills` runs it, and CI runs that. Each `ts`
   and `tsx` fence is compiled against the
   package source.
   - A plain fence is a whole example with its
     imports. It must compile.
   - `expect-error` marks a wrong example. It
     must fail.
   - `no-check` marks a fragment.
4. **Each rule has an id.** The form is
   `tinker/<name>`, as the lint prints it. A
   mistake in a skill carries the id of its rule
   in the heading. The skill's `description`
   names the ids, so an agent that sees an id in
   a check finds the skill.
5. **A check names the skill.** A finding prints
   the rule id and the skill to read next
   (`@tinker/core#core/operation`). The checks
   live in the app template today, so that work
   is its own card. (Built as a package:
   ADR 0145.)
6. **The bump stamps the version.**
   `scripts/bump.mjs` writes the new version to
   each skill's `library_version`. So
   `intent stale` stays quiet after a release.

## The rule ids

- `tinker/seam` — only a cmd reads env.
- `tinker/config` — config goes in the capsule
  call.
- `tinker/one-door` — reach a feature as
  `@/<feature>`.
- `tinker/cell-write` — an exported cell is read
  only.
- `tinker/plain` — every named function is an
  operation.
- `tinker/floating` — await each call of a root.
- `tinker/react-state` — no `useState`,
  `useReducer` or `useEffect`.
- `tinker/one-wire` — the page talks by rpc and
  remote data only.

## Two fits for Intent

Intent finds a package's source entry by the name
of its built entry: `dist/index.mjs` gives
`src/index.ts`.

- **Core.** Its entry is `src/main.ts` (ADR
  0130). So `package.json` has
  `"types": "./src/main.ts"` for Intent, and
  `publishConfig.types` gives the tarball
  `./dist/index.d.mts`. TypeScript reads
  `exports`, so the field changes nothing for an
  app.
- **zod.** Intent compiles the fences from the
  repo root. So `zod` is a root dev dependency.

## Proof

- A planted wrong fence fails at its line:
  `SKILL.md:193: TS2353 'name' does not exist`.
- `vp pm pack` of Core holds the six skill files,
  and its `types` is `./dist/index.d.mts`.
- A scratch app with that tarball and Intent:
  `intent list` shows 6 skills of `@tinker/core`;
  `intent load @tinker/core#core/operation`
  prints the file; `intent install` writes the
  block in `AGENTS.md`.
- Each runtime claim in the skills was run
  against the built 0.17.8: `MissingConfig`,
  `InvalidDependency`, `DataValidationFailed`,
  the three `settle` states, a memory pair.

## Not decided

- **One source for guide and skills.** The guide
  explains. A skill gives a task, whole examples
  and mistakes. They share facts. Whether the
  guide page is made from the skill is open.
- **The edit gate.** Intent can install a hook
  that stops an edit until a skill is loaded. It
  is off. Our checks cover the same risk after
  the edit.
- **`@tinker/bun`.** It has no skill yet.
