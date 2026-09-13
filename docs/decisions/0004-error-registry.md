# 0004 Each package throws only from one error registry

Date: 2026-09-13. Status: accepted.

## Context

Ad-hoc `throw new Error("...")` gives callers only a message to match on.
tinker-engine keeps one `errors.ts` per package with named errors and typed
payloads, and an `isError(e, "Name")` guard.

## Decision

Every package has `src/errors.ts` that defines its error names and payloads.
Code throws only from it. Callers narrow with `isError` and rethrow on
mismatch. No bare `throw new Error` or `TypeError`. Promises are awaited,
returned, or tracked; never dropped.

## Consequences

Census S04 and S05 fail strict mode on any hit. Tests assert a promised
payload, not class, name, or message text (census T07). The registry shape
(`defineErrors`) is written when the first package needs it; it is not
copied from tinker-engine.
