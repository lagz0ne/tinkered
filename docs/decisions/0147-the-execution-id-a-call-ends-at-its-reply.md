# 0147 The execution id: a call ends at its reply

Date: 2026-11-12. Status: accepted (Duke, 10:09,
picked "C. End at reply, id in fault").
Builds: ADR 0140 ("The execution id, at this level").
Keeps: ADR 0141 (no safe retry now).

## What the user said

- Duke, 2026-11-11 04:19: "If you are the trigger,
  then you'll be able to observe the executionId
  and you can resolve the waiting Promise".
- Duke, 2026-11-12 09:01 (acountee thread):
  "transform the executionId on to use remoteData
  and rpc".
- Duke, 2026-11-12 10:07: "How does tanstack query
  does that? ... We can actually just do as normal
  way of doing that, as long as the error is
  correct".

## Context

A test on 0.18.2, memory and ws, showed it:

```
server write
reply in; cell has 0   <- await ends
client cell now 1      <- the member comes
```

The lead built option A first: the server sent the
run's id in its signals before the reply, and the
call waited for the asks they started. It worked on
memory and ws, as they keep one order on one link.

TanStack Query has no execution id:

- A mutation ends when `mutationFn` returns.
- To see its own write, `onSuccess` returns
  `invalidateQueries`, and the mutation waits.
- The error is what `mutationFn` throws.

Duke took that shape (option C).

## Decision

1. **The client makes the id.** Each rpc call sends
   `meta.execution`, from `ctx.random.uuid()`. A
   resend after `renew` keeps it.
2. **The server binds it.** The run gets the
   `execution` tag, for its logs and writes. Only a
   plain id is taken: `[\w-]{1,64}`.
3. **A call ends at its reply.** No wait for signals.
4. **To see your own write, invalidate.** As
   `invalidateQueries`:

```ts
await run(api.move, { input });
await run(board.invalidate, {
  input: { tasks: { project } },
});
```

5. **The fault has the id.** `fault.execution` is
   the ref. The client's fault log and the server's
   `rpc call failed` log carry the same id. It works
   with tracing off.

## Why not A

- A needs one order on the link. HTTP calls with
  SSE pushes have none.
- A puts ids in signals and holds in the reader.
  C needs neither.
- C costs one more ask, only for a caller that
  wants to see its write.

## Proof

- `packages/core/tests/execution-id.test.ts`
- `packages/bun/tests/execution-id.test.ts` (memory
  and ws)
