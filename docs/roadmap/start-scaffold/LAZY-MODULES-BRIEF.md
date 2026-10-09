# scaffold/lazy-modules: the scaffold follows ADR 0107

Read [the fixed brief](../contributor-brief.md),
[ADR 0107](../../decisions/0107-a-body-gets-outside-libraries-only-from-its-deps.md),
and `coding-convention`.
Ticket 1, `start/lazy-modules`, is on main.
It added `scripts/check-lazy-modules.mjs` and `drizzleOrm`.
Read its notes in `docs/roadmap/start-base/PROGRESS.md`.

## Target

Package: `apps/start-scaffold`, plus `scripts/check-lazy-modules.mjs` and the root `lazy` script.
Do not change `packages/`, Core, React, or other apps.

### 1. The check covers the app

- The root `lazy` script checks `packages/start/src` and `apps/start-scaffold/src` in one run.
  So rule 9 holds across both.
- Save the red run on main's `apps/start-scaffold/src` first.

### 2. Checker extras from the ticket 1 review

- An inline operation is a unit body: the `run` in `scope.run({ run })`
  and every other inline form Core accepts. Read Core's types for the list.
- A React component passed as a value is not followed.
  Example: `resource({ factory: () => ({ Page }) })` must not fail on `useState`.
- "unit body not found" gets its own tag, `unit-body`, instead of `rule-7`.
- A `--prove` plant for each, matched by exact file, line, and tag.

### 3. Make the app pass

- Declare the app's lazy modules in `src/backend/modules.ts`.
  The frontend's go in `src/frontend/modules.ts`.
- Use `drizzleOrm` from `@tinker/start/server`. Do not declare a second one.
- Tables and schemas are own modules: import them at the top.
- Every unit drops its `import()` calls.
  This covers `counter.ts`, `todos.ts`, `profile.ts`, `sync.ts`, `database.ts`,
  `auth.ts`, `mail.ts`, and `frontend/auth-actions.ts`.
- Modules that exclude each other stay apart (rule 12).
  Record mode must still load no SMTP library.
- No body re-validates data an operation reads.
  Pass raw values as `rawInput`; Core checks them with the operation's `input`.
- Public types and behavior stay the same.

### 4. The words the app ships

- `.agents/skills/tinker-forms/SKILL.md:22` says
  "Load a native library inside its resource factory."
- `AGENTS.md:16` says "Load the native library inside its factory."
- Rewrite both to ADR 0107, in the file's style. For example:
  "A unit body gets a library only from a lazy module dep.
  Import tables, schemas, and own code at the top."
- Rebuild the registry: `vp run registry:build` in the app.

## Proof

- The gate chain from the fixed brief, with
  `vp run @tinker-start-scaffold#test` and `vp run @tinker/start#test`.
- `vp run lazy` and `node scripts/check-lazy-modules.mjs --prove` exit 0.
- The red run on main, saved.
- In the app: `vp run check:plain`, `vp run test:registry`,
  and `node maintain/check-imports.mjs` exit 0.
- No mutation lane: the app has none.
- Jev steps from the fixed brief.
- Keep proof files short: the header and the summary, not raw logs.

Do not ask questions.
Assume, write the assumption down, and go on.
Report everything in one final message.
