# start/lazy-modules: the base and the checker

Read [the fixed brief](../contributor-brief.md),
[ADR 0107](../../decisions/0107-a-body-gets-outside-libraries-only-from-its-deps.md),
and `coding-convention`.

## Target

Package: `packages/start`, plus one root script.
Do not change `apps/`, Core, React, or other packages.
The scaffold follows in its own ticket, on your branch.

ADR 0107 is the spec.
Its rules are numbered 1 to 12; this brief uses those numbers.
Graph code gets an outside library only from a lazy module.

### 1. The checker first

Write `scripts/check-lazy-modules.mjs`.
It takes src roots as arguments:

```bash
node scripts/check-lazy-modules.mjs packages/start/src
```

- Read `*.ts` and `*.tsx`; skip tests, `.d.ts`, and `.gen.` files.
- Use the TypeScript 5.9 API, as `apps/start-scaffold/scripts/check-plain.mjs` does.
  If the root has no such package, add `"typescript-api": "npm:typescript@5.9.3"`
  to the root devDependencies. That is the one dependency change allowed.
- **Unit body:** the `run` of `operation({...})`, the `factory` of `resource({...})`,
  and each member of `hooks` in `extension({...})`.
  The call must resolve to `@tinker/core`.
- **Graph code:** a unit body, plus every own function it calls,
  followed through each call with the type checker.
- **Own or outside:** resolve a name through every alias to its declaration.
  It is own when the declaration's real path is not under `node_modules`.
  Workspace packages are links, so use the real path.
- **Rule 7:** fail on a value use of an outside name inside graph code.
  Type positions are fine.
  Property reads on own values are fine (rule 6), such as `env.safeParse(x)`.
- **Rule 8:** fail on `import()`, `require`, or `createRequire` inside graph code.
  The one exception is a lazy module's factory, below.
- **Rules 9 and 10:** a lazy module is `resource({...})` whose factory is `() => import(<path>)`.
  It has exactly the keys `label`, `target`, and `factory`.
  The label is `module:<path>`, the target is `"scope"`, and the path is a string literal.
  Fail on any other shape.
  Fail when two lazy modules name one path, across every root given.
- Print `file:line rule-N: <what>` per hit. Exit 1 on any hit.
- `--prove` runs planted files. Each failure must exit 1 by its rule number.
  Each allowed case must exit 0:
  a table read in a body, `schema.safeParse` in a body,
  `import type`, an own helper, and a lazy module.
  Plant a helper that calls an outside name; rule 7 must catch it through the call.

Framework code is not graph code (ADR 0107, "Where it holds").
`entry/router.tsx` (a `createIsomorphicFn` branch) must not fail.
Neither must `parts/sync/functions.ts` (server function handlers).

Add the root script `"lazy": "node scripts/check-lazy-modules.mjs packages/start/src"`.
Commit the checker with its red run on main's `packages/start/src` saved as proof.

### 2. Make the base pass

- Add `src/modules.server.ts` with the base's lazy modules.
  `drizzleOrm` is one of them (`module:drizzle-orm`).
- Export `drizzleOrm` from `src/server.ts`.
- `parts/sync/history.server.ts` and `parts/sync/stream.server.ts`:
  drop the `import()` calls.
  Depend on `drizzleOrm`; import the tables at the top from `./schema`.
- `backend/body.server.ts`: `transferResponseBodyOwnership` runs in graph code.
  Take it from a lazy module for `@tanstack/react-start/server`.
- Fix every other hit the checker reports in `packages/start/src`.
- Public types and behavior stay the same.

The scaffold still uses its own `import()` calls after this ticket.
Its tests must still pass.

## Impact block

The block is in [PROGRESS.md](PROGRESS.md#startlazy-modules).
`drizzleOrm` is the one new public symbol.

## Proof

- The gate chain from the fixed brief, with these tests:
  `vp run @tinker/start#test` and `vp run @tinker-start-scaffold#test`.
- `vp run lazy` exits 0. `node scripts/check-lazy-modules.mjs --prove` exits 0.
- The red run on main, saved in the first commit.
- `node apps/start-scaffold/maintain/check-imports.mjs` exits 0.
  Importing the backend still loads no driver, auth, or mail library.
- Mutation for `@tinker/start` under `flock /tmp/mutation.lock`.
  The floor is 75, on kills alone, on a clean tree; name the commit.
- Jev steps from the fixed brief.
- The impact `refs`.

Do not ask questions.
Assume, write the assumption down, and go on.
Report everything in one final message.
