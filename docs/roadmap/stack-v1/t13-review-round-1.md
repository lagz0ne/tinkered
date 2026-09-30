# t13 review round 1 proof

The six requested fixes are in `54922a9b`.
Gate and callback cost notes are in `73d86cba`.

## Changes and checks

- Queue finished spans and logs by reference.
  Read ids and encode at flush.
  Reject a full queue before encoding the new record.
  Keep the 2048-record cap and the 1 MiB batch cap.
- Encode bigint and safe integers as decimal `intValue` strings.
  Other finite numbers use `doubleValue`.
- Forced close aborts the send and drops the queue.
  It makes no new collector request.
  Graceful close gives all network work one shared second.
- Successful spans omit status.
  Failed spans use code 2 and the Error message,
  or `String(error)` for another thrown value.
- Every 2xx response counts as delivered.
  Tests cover 202 and 204.
- NATS with observation off uses plain publish.
  Tests check the raw message and sent byte count.

Eleven stack assertions fail against the old implementation.
The new NATS test also passes on the old code:
this installed client encodes empty headers as zero bytes,
but still picks HPUB when passed a headers object.
The fix keeps that branch small, as the review permits.

## Gate

```sh
vp run -r build && vp check \
  && vp run stack#test && vp run nats#test \
  && vp run @tinker-issue-tracker#test
# EXIT 0
```

- Check: 0 errors, 29 existing warnings.
- Stack: 92 tests passed.
- NATS: 24 tests passed.
- Tracker: 79 tests passed.
- All packages: `vp run -r test`, EXIT 0.
- `pnpm validate`: all 48 lanes passed, EXIT 0.
- Both style censuses: OK.
- Jev tests and README promises: no flags or gaps.
- Jev preflight: no file flags.
  NATS cleanup keeps its existing label:
  `stateOutsideCell=false`, `ab70cbe9e7ba`.
  It owns pending driver work, not app state.
  `wrapsCallersStep` is a noisy note.
  No new labels were added.

## Mutation

Each writer lane ran once under `/tmp/mutation.lock`,
with a 60-second timeout per mutant.

- Stack: 85.61%, EXIT 0.
  Killed 465; timeout 5; survived 76.
  No coverage 3; errors 0.
- NATS: 92.74%, EXIT 0.
  Killed 166; timeout 0; survived 10.
  No coverage 3; errors 0.

Raw logs and mutation JSON are in
`.bench/stack-t13-proof/round1/` in the writer worktree.

## Assumptions and outside changes

The graceful-close window starts at the close hook.
It uses the scope clock.
Tests advance that clock and count requests;
they do not depend on a speed bound on this busy machine.

The writer ran no rebase and no push.
Another process rebased the worktree at 02:44 UTC.
That changed the fix commit from `9c964de1` to `54922a9b`
and brought in t06 at base `2700a440`.
The writer kept those changes, ran `vp install`, rebuilt,
and reran the full gate and validation.
The trace and NATS fix files did not change in that rebase.
The mixed-tree validation from that time is not proof.

Another process later edited the board and track notes.
Those edits are left intact; this file holds the final proof.

Core feedback is unchanged from the first round.
The start logger still drops this line:

```ts
start: (_scope, ctx) => ctx.log.warn("boot");
// Expected sink lines: 1. Actual: 0.
```

`core/start-log` already tracks it.
The sink writes warnings through its local JSON sink.
Span kinds, shared traceparent code, and sub-ms times
remain the lead's follow-ups, as requested.
