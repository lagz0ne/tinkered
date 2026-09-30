# Keep call cancellation off the ordinary tagged path

Date: 2026-09-30.
Source: `577e7f6c`; integrated as `db6d53bf`.

## Problem

A call signal gives one action a child session.
The child owns waits, retries, and cleanup.
Ordinary tagged calls still use the existing small frame.

A callback inside `runTagged` captured its input and target.
V8 built its function context even when the session branch was not taken.
The first queued check reported tagged calls slower.
The paired sign test had 41 slower rounds out of 61, p = 0.00985.

## Change

Bind the body helper only after choosing the session branch.
Ordinary tagged frames then need no body callback context.
Call property reads and their short-circuit order stay unchanged.
The cold branch still reads the signal at its existing point.

Private single-use close helpers fund the added body helper.
Their expressions, awaited promises, and cleanup order stay unchanged.
The existing teardown decision also records its next cancellation flag.
That keeps the close body within its branch limit.
Empty child close still awaits the shared ready promise.

Core tests: 790 pass.
Full build, check, all 18 test tasks, prose, and 48 release lanes pass.
Core gzip: 16,384 bytes against the 16,384-byte cap.
The last hot slot is 251, leaving four names.
The strict census has the same 14 old rows and no new row.

## Queued recheck

A: `1c5c82fe`.
B: `b2fe2204`, with the same Core source as `db6d53bf`.
Both trees were clean, installed, and built.
One probe reads both built entries.
Each of the five paths ran 61 paired rounds in batch mode.
Timing used `bench/queued.sh` under the shared mutation lock.
The queue pinned one core and removed network and secrets.

Two-sided paired sign test: p below 0.01 means a seen difference.
The verdict for every checked path is no difference we can see:

- `op`: 21 slower rounds; p = 0.39160.
- `run`: 28 slower rounds; p = 0.79484.
- `session`: 30 slower rounds; p = 1.00000.
- `tagged`: 36 slower rounds; p = 0.20003.
- `lifecycle`: 27 slower rounds; p = 0.44263.

These paths check old calls; they do not measure every call path.
Signal calls intentionally pay for their own child lifetime.
No claim about that added cost comes from this run.

Raw rows are kept with the track:

- [First check](../../docs/roadmap/authoring-model/call-signal-first.csv).
- [Final check](../../docs/roadmap/authoring-model/call-signal-final.csv).

Reproduce from the clean B worktree:

```bash
N=61 A=../tinkered-authoring-call-base \
  SCEN="op run session tagged lifecycle" \
  bench/queued.sh
```
