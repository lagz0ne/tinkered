---
name: coding-convention
description: Use whenever writing, editing, or reviewing TypeScript source or tests in this repo (.ts, .tsx, *.test.ts). Trust the types, managed errors, behavior tests at the public seam with no mocks, TSDoc only, plain `private`, YAGNI. Ends with the style census. Not for prose, docs, or config-only edits.
---

# Coding convention

Write for a reader who wants to reason about the code. Each rule is an
intention, then the shape it produces. When in doubt, the shape the reader
holds easiest wins.

## Intentions

1. **Trust the types.** Outside-process data (network, fs, env, argv, user
   input) is validated once at the door, then passed on as typed facts. Inside,
   never re-check a typed value: no `typeof` walls, no `if (!x)` on a typed
   parameter, no `as unknown as`. An `isX` guard is a discriminator, not a
   safety wall: it checks the smallest stable shape needed to narrow. A `readX`
   reader does any real admission once and captures the facts later code needs.

2. **Errors are managed.** Each package has one `src/errors.ts` that names every
   error and its payload type. Code throws only from that registry. Callers
   narrow with `isError(error, "Name")`; on mismatch they rethrow. No bare
   `throw new Error`, no `TypeError`. A promise is awaited, returned, or tracked
   by its owner; `.catch(() => undefined)` and bare `void promise` do not exist.

3. **Nothing in `src` prints.** No `console.*` in source. Emit events or return
   values; let the caller decide what to show.

4. **State lives with its owner.** Records are plain object types; `?` marks
   state that can be absent, not a slot for later. Lifecycle is a string union
   or a `{ kind }` union. No `enum`, no tuples read by index, `readonly` only
   where promised, `as const` only for literals.

5. **`type`, not `interface`.** Declare shapes with `type X = { ... }`.
   Use `interface` only when it is needed: a class `implements` it, a later
   module must merge into it (an open registry), or a recursive shape the
   `type` form cannot express. Say which reason in the TSDoc.

6. **One namespace per concept.** Types that belong to one concept sit in
   `export declare namespace <Concept> { ... }` in that concept's module,
   named after the runtime value that creates it: `createTasks()` returns
   `Tasks.Handle`; a task is `Tasks.Task`. Runtime values stay top-level
   exports. No loose `TaskLike`, `TaskOptions`, `TaskResult` siblings.

   ```ts
   export declare namespace Tasks {
     type Task = { id: string; title: string; done: boolean }
     type Handle = { add(title: string): Task; complete(id: string): void }
   }
   export function createTasks(): Tasks.Handle { ... }
   ```

7. **Private is `private`.** Class internals use the TypeScript `private`
   keyword. Never `#private`, no `Reflect.*`, no nested classes.

8. **Names say the thing.** Nouns for things, verb first for functions:
   `createX`, `readX`, `isX`, `assertX`. `XImpl` is the class behind interface
   `X`. No layer words (`Runtime`, `Manager`, `Handler`, `Wrapper`, `Base`),
   no `AnyX` alias, no type suffix on a handle.

9. **Infer, do not restate.** A public function with two or more input
   shapes gets one typed overload per shape; the implementation signature is
   broad and dispatches. One input shape means one signature and no overload. No
   generic the compiler already infers, no facade, no pass-through variable
   that adds no meaning. Keep a local only for narrowing, read order, or
   ownership.

10. **Words only where code cannot speak.** TSDoc (`/** */`) on exported
    interfaces and functions only. No other comments. No `@ts-ignore`,
    `@ts-expect-error`, or lint-disable lines; fix the cause.

11. **Build only what today needs (YAGNI).** No options, wrappers, schemas, or
    extension points for a future caller. Do not invent a failure mode, input
    check, or edge case the task did not name; if one seems needed, ask.
    Add a helper for real repeated work,
    not hoped-for reuse. A shorter form must keep the same reads, read order,
    error boundaries, narrowing, identity, and copies. Fewer lines do not prove
    less work.

12. **Own before reusing.** At every handoff say who owns the value: borrow,
    transfer, or retain. Copy for isolation; share exact identities and opaque
    values. Copying a container does not copy its contents. No pools or caches
    on a guess; release retained references.

13. **Change safety.** A new failure mode or a lifecycle change means listing
    every caller before merging. A test asserts only a shipped guarantee.

## Tests

Tests prove behavior at the public seam. There are no unit tests of helpers
or private modules.

- A test file imports only the package entry (`../src/index.ts`), never a
  private module.
- Flat `test("does x", ...)`, or `it` inside one `describe` per file. The
  title says the behavior in plain words. A regression test names the bug.
- Fixtures sit at the top of the file, built with the public API. A helper is
  allowed only when it removes real repeated work, stays under 20 lines, and
  there are at most three per file. No `as unknown as`, no casting builders.
- No mocks: no `vi.mock`, `vi.fn`, `vi.spyOn`, no global patches. A fake
  behaves like the real dependency.
- No sleeping: no `setTimeout` waits. Poll for the state you expect.
- One test names one public cause and checks one decisive public outcome.
  Several short assertions for one outcome are fine; do not wrap facts just to
  cut the count. Exact reference uses `toBe` / `not.toBe`; deep equality proves
  value shape only.
- Assert values, states, and events. Never internals: no `Object.isFrozen`,
  prototypes, private fields, allocation counts.
- `isError` narrows by control flow: `if (!isError(e, "Name")) throw e`. Then
  assert only a promised payload, not class, name, or message text. Never put
  `isError(...)` inside `expect(...)`; a negative twin (`isError(e, "Other")`
  is false) proves nothing the positive did not.
- No `.only`, no `.skip` in committed tests.

Over-testing is a defect, not caution. Before keeping a test ask: which shipped
promise breaks if this test is deleted? No answer means delete it.

- Do not test a guard or helper on its own (`isError(null, ...)`,
  `createX()` returns empty). Test the behavior that uses it.
- Do not re-prove the same promise from a second angle (`toBe` then
  `toEqual`, positive then negative twin, count then contents).
- To prove two failures are distinct, reject the wrong one by control flow
  inside the test that already exists: `if (isError(e, "Other")) throw e`.
  Not a second test, not `expect(isError(...))`.
- Do not test what the type system already guarantees.
- Do not add a test to raise a mutation score. A surviving mutant is a real
  bug to test only when a user could observe it through the public seam.
- Fewer tests that each name a distinct promise beat many small ones. The
  target is coverage of promises, not of lines.

## Worked example

`examples/tasks/` in this skill is a small task list written to these rules:
`src/errors.ts` (registry + `isError`), `src/tasks.ts` (handle returning
copies), `tests/tasks.test.ts` (five behavior tests at the public seam, one
control-flow line to tell two failures apart). Read it before writing a new
package. The root test run collects it, so it stays honest.

## Performance

Learned on `@tinker/core` (see `research/learnings/2026-09-16-core-vs-inferdi.md`). The
hot path is anything a request pays: create a scope, build a resource, run an op, close.

1. **Measure, then change, then measure.** One scenario per process, pinned to one
   core, min ns/iter (`taskset -c N node --expose-gc <probe> <scenario>`). Grouped
   benches and heap minima are GC-noisy; a change is kept only when the standalone
   probe moves and no other scenario regresses. Record the numbers in the commit.

2. **No accessor in an object literal.** `{ get x() {} }` is built through slow
   runtime calls on every creation (measured 0.3–2.5 µs). A lazy member is a class
   with a prototype accessor. A member that callers destructure (`{ defer }`) is an
   arrow field on that class, never a method.

3. **No `Object.defineProperty` on a hot path** (~300 ns). Shape objects with
   fields, classes, or a Proxy with one shared trap object. A trap that must define
   a property (a write to a not-yet-built key) is a cold path; the census watches it
   (W12) and the reviewer judges.

4. **Allocate on first use, share what never changes.** Collections, controllers,
   AbortControllers, and ctx objects are made when first read, not when the owner is
   made. A default that is never mutated (observation off, empty ctx) is one shared
   instance. Grow a `Set`/`Map` with `add`/`set`, not from an array literal.

5. **One lookup per record.** Fetch a stable record once (`nodeState`) and use it for
   every check and write in that operation; do not re-look it up through the map.

6. **State on the instance, not in closures.** A per-instance handler or trap set
   is one module-level object; the per-instance facts sit on the instance (a field,
   or a symbol slot on a Proxy target reported non-enumerable).

7. **Laziness has a price on the other side.** A lazily made signal costs an
   `abort()` dispatch (~430 ns) on forced close once it exists; a failed async build
   stays sticky on its node so a retry does not rebuild it (ADR 0044). Measure the
   close/failure path too.

8. **Keep the public shape spreadable when the contract allows spread.** A value
   users may copy with `{ ...x }` (a scope handle) stays an object of own
   properties; prototype methods vanish in a copy. A ctx is passed by reference.

9. **Only syntax `node --experimental-strip-types` accepts.** No constructor
   parameter properties, enums, or namespaces with values; the budget lanes run the
   source directly.

10. **A perf change ships with** the probe numbers before/after, `vp check` and
    `vp test` green, a seam test for every changed semantic, and a learnings entry.

Review checklist for a perf diff: getter in a literal? defineProperty? eager
collection or controller that most callers never use? repeated map lookups on the
same record? per-instance closures where a shared object would do? failure and
close paths measured? public spread contract kept? strip-types clean? numbers in
the commit?

## Check

Formatting and lint are the machine's job. Run, in order:

```bash
vp check
vp test
bash .agents/skills/coding-convention/scripts/style-census.sh <dir...> --strict
node scripts/jev/preflight.mjs   # advisory: anti-goal judges + per-unit lint on your diff
```

Fix every strict hit. Jev notes are look-here hints, not failures: clear the ones you agree
with, explain the rest in the report's `jev pre-flight` line. Unsure which unit a piece of
logic should be? Ask before writing it: `node scripts/jev/guide.mjs "<logic in words>"`. Then end the handoff with this standalone line, no
bullet, quote, or code formatting:

Style census: OK
