# 0127 A call waits for start, and a test capsule ships test tooling

Date: 2026-11-08. Status: accepted; built on main
(card `core/start-gate-test-capsule`).
Decision 5 (`testCapsule`) retired by ADR 0131.
Accepted: Duke, 2026-11-08 14:19 UTC: "Yeah, let's do that
so we can settle the release".
Builds on: 0050, 0085, 0121.
Replaces: the test mode drafts (scope `mode`, capsule `tests`,
four test primitives). They never landed.

## What the user said

- 09:05: "Don't wrap function. The test unit should manage its
  own". "I wonder why the run doesn't auto wait for the ready".
  "The ready is meant for completely different reason".
- 09:05: "every ops should be aware of ready and closing state".
- 13:58: "Maybe we can simply shape testCapsule and treeshaking
  off that".
- 14:19: yes to a test capsule that reaches exports only.

## Context

A run before `ready` ran at once.
A unit that a capsule's `start` fills was not there yet.
So the call raised `NotResolved`, or a capsule's own
`DatabaseNotStarted`.
Each test had to `await scope.ready` or wrap `createScope`.

The closing state already holds: a closing or closed scope
refuses a new call (`Disposed`, ADR 0028).

Test tooling had a large draft: a scope `mode`, a capsule
`tests` attribute, four test primitives, and a build plugin.

## Precedent

- **Fastify.** `app.inject()` calls `ready()` itself.
  ADR 0050 took `ready` from Fastify.
- **Mongoose.** A query waits until the connection opens
  (`bufferCommands`).
- **TC39 explicit resource management.** `await using x`
  calls `x[Symbol.asyncDispose]()` at the end of the block.
- **Angular `HttpClientTestingModule`.** A test-only module
  in a `testing` entry. A test installs it. A prod build
  never imports it.
- **Go `_test.go`.** Test code is a separate file that the
  build leaves out.

Where ours is simpler:

- No mode, no flag, no build plugin.
  A prod file does not import `@tinker/core/testing`,
  so the bundler leaves the test capsule out.

## Decision

1. While a root starts, an outside call waits for every
   start, then runs. These verbs wait:
   - `run`, `settle`, `session`;
   - `controller(op).run` and `.settle`;
   - the same verbs on a session made during start,
     at any depth.
2. After a failed start or a close, a waiting call meets
   the closed scope, as a new call would:
   `run` raises `Disposed`; `settle` returns its result
   and never throws. `ready` still rejects with the start
   error.
3. After start, each verb holds its plain method again.
   Nothing is deleted, so the handle keeps a fast shape
   (V8 `%HasFastProperties` is true).
4. A scope handle has `[Symbol.asyncDispose]`.
   `await using scope = createScope(...)` closes it at the
   end of the block.
5. `testCapsule(of, def)` lives in `@tinker/core/testing`.
   - It is a capsule with the label `<of>.testing`.
   - `def` is a capsule's `def` without `label`.
   - It reaches `of` through its exports only.
   - Its ops reach `of` through `of`'s exports, so a run
     that needs `of`, with `of` not installed, raises
     `CapsuleMissing`. `testCapsule` itself checks nothing.

```ts
// auth.testing.ts: only tests import it
export const authTesting = testCapsule(auth, {
  exports: { signInAs },
});
```

```ts
await using app = createScope({
  capsules: [auth({ api: fakeApi() }), authTesting],
});
await app.run(authTesting.signInAs);
```

## Consequences

- One test, `index.test.ts` "running an operation on a
  pending extension dependency", now checks the wait.
- During start, `controller(op)` returns a new object on
  each call.
- A sync op's `run` returns a promise while the root starts.
  Its type still says the plain value. `await` it.
  A ready scope keeps the sync return.
- `resolve` and cell reads do not wait. They stay as they
  were. Open: should they raise `NotReady` during start?
- An app checks that its prod bundle holds no
  `@tinker/core/testing` module. tinker-app's
  `check-client.ts` already checks bundles the same way.
