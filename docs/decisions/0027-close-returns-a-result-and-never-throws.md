# 0027 close() returns a Result and never throws

Date: 2026-09-15. Status: accepted. Supersedes the Q4 _throw-on-invalid-transition_ answer of
[0026](0026-teardown-is-reverse-registration-lifo.md) (keeps 0026's state-machine intent: one owned
end per lifetime). Refines [0011](0011-close-is-structured-and-total.md) and
[0017](0017-outcome-outside-in-success-inside-out-failure.md).

## Context

`close(outcome?)` took an outcome and returned `Promise<void>`, throwing `TeardownFailed` (and, for a
session, the failure cause). Two problems surfaced designing lt3's Q4:

1. The outcome you pass is a **wish**, not a command — you cannot cancel away a failure that already
   happened. When wish and reality disagree, the settlement reducer already lets reality win (a real
   body/owned failure beats a wished `cancelled`). So "your wish conflicts with reality" is not a
   caller error to throw on; it is information the caller should receive.
2. `close()` is called in `catch`/`finally`/teardown. A `close()` that throws there buries the
   original error under its own `TeardownFailed`. "Dispose must not throw" is the well-worn rule.

## Decision

**`close(wish?)` always resolves to a `Result` and never throws.** The `wish` is a fallback: it sets
the outcome only when reality is otherwise undecided (a clean run can be marked `cancelled`); a real
failure always wins. The `Result` reports the **actual** settled state plus every error collected
along the teardown, so the caller reacts to the truth:

```ts
type Result =
  | { readonly status: "success"; readonly teardownErrors?: readonly unknown[] }
  | {
      readonly status: "cancelled";
      readonly reason: unknown;
      readonly teardownErrors?: readonly unknown[];
    }
  | {
      readonly status: "failed";
      readonly error: unknown;
      readonly teardownErrors?: readonly unknown[];
    };
```

- **No throw, no opt-in.** There is no `throwOnError` flag — a single, uniform shape (rejected as not
  worth the surface). `teardownErrors` (defer/cleanup throws, aggregated in execution order) may be
  present on ANY status; `error` is the failure cause when `status === "failed"`.
- **Reality wins; wish is a fallback.** Precedence is the existing reducer (real body failure → owned
  work → inherited/explicit wish → cancellation fact → success). A wished `cancelled`/`failed` on an
  otherwise-clean close is honored; it never overrides a real failure.
- **One owned end (0026 Q4 intent kept).** The first end to settle owns the outcome; later requests do
  not silently overwrite it — they get the already-settled `Result` back. No invalid-transition throw
  (superseded): the guarantee is "you always learn the truth," not "you get an exception."
- **Scope: well-behaved values only.** "Never throws" and "cleanups always run" hold for ordinary
  values. The library does NOT defend against adversarial userland objects returned from a cleanup or
  body — a thenable whose `then`/`constructor` accessor throws or mutates across reads, or a reject
  value that is a `Proxy` whose `has`/`get` trap throws. Reading such a value can surface its throw or
  leak an unhandled rejection; that is the caller's bug, not the library's (v1 decision — we do not
  harden against user wrongdoing). Revisit only if a real, non-adversarial case appears.

`session(fn)` is a different verb and keeps promise semantics: it resolves the body's value and
rejects a real failure / cancellation (idiomatic "run this and give me the value"). Internally the
session reads its layer's close `Result` to decide resolve-vs-reject. `release()` stays void; its
teardown errors surface in the owning scope's close `Result.teardownErrors`.

## Consequences

- `close()` signature changes `Promise<void>` → `Promise<Result>`; it never rejects. Callers that only
  want to tear down ignore the return; callers that care inspect `result.status`/`error`/
  `teardownErrors`. Breaking, acceptable pre-v1.
- The internal settle path stops throwing `TeardownFailed`; it builds a `Result`. The session settle
  reads that `Result` and throws/rejects on the session's own promise (so `session(fn)` behavior is
  unchanged for callers).
- Q4 of 0026 (throw on invalid transition) is withdrawn: a second/conflicting `close()` returns the
  owned `Result` rather than throwing. Built as part of core/lt3 against the ledger
  `docs/roadmap/core-v1/teardown-redesign.md`.
