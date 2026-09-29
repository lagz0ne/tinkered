# 0085 A root owns its lifetime: a stop signal, `closed`, and `ready` after cleanup

Date: 2026-09-29. Status: accepted. Replaces: 0078 §6 (every root closes a failed `ready` by
hand). Builds on: 0027 (one `Result`), 0028 (graceful vs forced close), 0050 (extensions), 0073
(pay on first use).

## Context

Every root wrote its own lifetime by hand. `runUntilStop(scope, stop, observe)` in
`@tinker/stack` shows all of it:

- It awaits `ready` and, on a rejection, closes and waits itself. Core rejected `ready` before
  its forced close had ended, and that close skipped the extensions' close hooks.
- It waits for a stop signal by hand, then closes and reads the `Result`.
- It takes the scope as a parameter, which the "two hands" rule forbids.

About a dozen roots copied the catch, close, and rethrow: `process` `execute`, the tracker's
test fixtures, four examples, a sync test. A committee (Astra and Opus, two rounds) settled the
fix; the user chose that core owns it.

**The precedent is the web's `signal` option.** `fetch(url, { signal })`,
`addEventListener(type, fn, { signal })`, and Node's `server.listen({ signal })` each stop
themselves when the signal aborts, handle a signal that already aborted, and drop their own
listener. A web stream writer has the other half: `ready`, `close()`, and a `closed` promise.
POSIX treats SIGTERM as a request to stop gracefully (ADR 0028). TC39 `await using` would close
at the end of a block, but Node 22.23 here cannot parse it.

## Decision

1. **A root can take a stop signal.** `createScope({ signal })` returns a `Scope.RootHandle`.
   `signal` lives on `Scope.RootOptions`; a session takes `Scope.Options`, which has none.

   ```ts
   const scope = createScope({
     ...pieces,
     signal: stop,
   });
   const end = await scope.closed;
   ```

2. **An abort closes the root gracefully, after start.**
   - Already aborted, or aborted during start: the close begins once `ready` resolves.
   - A failed start: its forced close is the only close.
   - A close already under way wins; core drops its listener when any close begins.
   - A graceful close never aborts `ctx.signal`: this signal asks the root to stop, while
     `ctx.signal` cancels work.
3. **`closed` reports how the root ended.** Only a root made with a `signal` has it.
   - It holds core's own `Result` from the real close, after the close hooks' after-work.
   - It settles once, never rejects, and stays pending while the root is open.
   - Until `core/close-hook-scope` lands: a close hook that skips `next()` (or throws before
     it) leaves `closed` pending; a hook's throw after `next()` is not in the `Result`.
4. **`ready` rejects only after the forced close ends.** Core's own closes (a failed start, the
   signal) go through the handle's `close` as it is at that moment, so every close hook runs:
   sync ends its streams, NATS drains. A cleanup that never ends also holds `ready`; that is
   the cleanup's bug (ADR 0028).
5. **Only a root that asks pays.** A root with extensions or a signal takes the extension path,
   and `closed` is a plain property there. No getter on the shared handle: a getter in an
   object literal costs a runtime call each time the literal is built, and `session(fn)` builds
   that literal (core-feedback row 57 measured one extra field there at +15–17 ns).
6. **The exit code stays outside core.** Stack's rule: a `failed` end answers 1, any teardown
   error answers 1, anything else answers 0 (a `cancelled` end is a clean stop).
   `@tinker/process` keeps its own forced stop and its 130.
7. **Two plain rules keep it.**
   - **S19** joins the repo lint for `apps/*/src`, `examples/`, and `packages/stack/src`, and
     sees `Scope.RootHandle`.
   - **S29** flags a lifetime written by hand once this lands: a catch of `ready` that closes
     the same root, and a wait on an abort followed by a graceful close.

## Consequences

- `runUntilStop` is deleted; an entry is the three lines above plus its exit code.
- The catch, close, and rethrow copies go away; `docs/roadmap/core-feedback.md`'s row on
  `ready` is done.
- A failed start now runs the extensions' close hooks.
- Follow-up cards: `core/close-hook-scope` takes the hook rules (a root's hooks run once,
  cannot skip cleanup or replace its outcome, and their throws become teardown errors); a small
  `process` card checks an abort that fired during `createScope`.

## Options considered

- **`closed` on every root, as a lazy getter.** Rejected: the getter costs every handle literal,
  and `extendHandle`'s spread would read it at once.
- **One listener line in each entry.** Rejected: it misses an already aborted signal, drops a
  late `ctx.defer` when it closes during start, and never removes its listener.
- **`@tinker/process` owns the lifetime** (a server is a command). Rejected by the user: every
  server would go through the command shell, and tests would still wait by hand.
- **Change the close-hook rules here.** Moved to `core/close-hook-scope`: that card owns the
  hook contract, and core takes one card at a time.
