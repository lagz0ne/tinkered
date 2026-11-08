# 0128 A root with capsules has a starting type

Date: 2026-11-08. Status: accepted; built on main
(card `core/starting-typestate`).
Accepted: Duke, 2026-11-08 16:42 UTC: "Yeah".
Refines: 0127 (a call waits for start).
Builds on: 0050, 0085.

## What the user said

- 16:38: "Might it be Promise if the scope hasn't
  started?"
- 16:42: "Yeah" to land it as 0.14.0, a breaking change.

## Context

Under ADR 0127 a call made during start waits.
A sync op's `run` then returns a promise, but its type
still said `T`.
A test that did not `await` it passed with no real check.
Hedl found 44 such calls; Core's own suite had 13.

## Precedent

- **Typestate.** Rust builders and session types: the type
  names the state, and a state change gives a new type.
- **`fs.promises` vs `fs`.** One API in two forms: every call
  async, or every call sync. The caller picks the form.
- **`no-floating-promises`.** The lint flags a promise that
  no one awaits, once the type says it is a promise.

Where ours is simpler:

- Two states only: starting and started.
- One step between them: `await scope.ready`.

## Decision

1. `createScope({ capsules })` returns a `Scope.Starting`.
   - `run`, `settle`, `session` and `controller(op).run`
     always return a promise, before and after start.
   - Before start ends, a call waits, as in ADR 0127.
   - `createSession()` gives a `Starting` too.
   - Its `ready` resolves to the started session.
2. `scope.ready` resolves to the started `Scope.Handle`.
   Its sync calls stay sync.
3. A root with no `capsules` is a plain `Scope.Handle`, as
   before.
   - `capsules` that may be unset (a variable) types as
     `Scope.Handle | Scope.Starting`.
     `capsules: []` is a `Starting`.
4. A replaced `close` on the starting handle lands on the
   started handle, so a failed start still calls it
   (ADR 0085).
5. `isStarting(scope)` tells the two apart at runtime.
6. React's `ScopeProvider` takes either.
   With a starting root it waits on `ready` with React's
   `use`: a `<Suspense>` above shows its fallback, and a
   failed start reaches the error boundary.
   - With `create`, it renders nothing until start ends.
     It does not suspend: StrictMode replays the effect
     of a provider that a Suspense boundary hid and showed,
     and that replay would close the scope in use.

```ts
await using app = createScope({ capsules: [menu] });
app.run(setOpen); // lint: no-floating-promises
await app.run(setOpen); // ok
```

```ts
const live = await createScope({ capsules }).ready;
live.run(setOpen); // sync, as before
```

## Consequences

- Breaking. Code that ran a capsule root's ops sync now
  awaits each call, or takes `await scope.ready` first.
  The compiler and the lint list each place.
- A server render (`renderToString`) cannot wait for
  Suspense: pass it the started handle.
- An app should make `no-floating-promises` an error.
- ADR 0127's sync-type gap is closed.

## Impact

`createScope`'s return type changes. Files that call it:

- tinkered packages: 103.
- tinkered tools: 18 (flight-trial moved here).
- tinkered apps: 2.
- tinker-app: 24.
- Hedl: 107.

The compiler lists each place that needs `await`.
SCIP could not index in the lead's sandbox, so these
counts come from a text search.
