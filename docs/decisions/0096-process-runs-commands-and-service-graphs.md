# 0096 Process runs commands and service graphs

Date: 2026-10-01. Status: accepted.

## Context

The Process review found that live output was also kept in memory.
Forced process exit cut off pending pipe writes.
Cleanup failures could still answer success.

An MCP service needed a stop cell and a waiting operation just to stay open.
Core already owns that lifetime through a root's signal and `closed` result.
The user approved a smaller Process API after the review.

## Decision

Keep the Unix main model from ADR 0056: route, run, clean up, answer a code.
Keep help, version, and unknown routes outside Core.
A selected loader receives `{ args, signal }` and supplies static graph units.

Use one object with two entry cases:

```ts
{ kind: "command", op: check }
{ kind: "service", options: {
  extensions: [stdio, searchMcp],
} }
```

A command runs its operation and ends its root after the answer.
External abort force-closes that root, preserving its data owner.
ADR 0090's call signal would create a child session and fork data writes.

A service starts its extensions and waits for the root's `closed` result.
Signals request graceful stop as in ADR 0085.
A static `stop` tag carries the same borrowed stop function to an extension.
Stdin EOF can call it without a data cell or a waiting operation.

`run` takes one object with explicit arguments and writers, and answers a number.
Its environment defaults to an empty record; it reads no host process facts.
Output collection belongs to the caller that needs it.
Remove public `execute` and `Process.Result`.

`main` takes one object and binds real process facts once.
It returns the code after cleanup and never calls `process.exit`.
The guarded app sets `process.exitCode`, letting pending writes finish.
Both signal listeners leave on first stop so the next signal has its normal action.

```ts
if (import.meta.main) {
  process.exitCode = await main({ shell });
}
```

A failed start or cleanup turns a successful run into exit 1.
An earlier command failure keeps its own code and error.
Abort while loading answers 130 without waiting for the loader to finish.
The pending load remains observed if it rejects later.

This replaces ADR 0056's published executor, captured result, positional calls,
and server-as-command rules.
Its operation, routing, lazy loading, and static process tag rules remain.

## Precedent

Node advises setting `process.exitCode` so pending output can finish.
[Node process exit rules](https://nodejs.org/api/process.html#processexitcode).
Core owns shutdown; Process only binds the outside stop requests.
