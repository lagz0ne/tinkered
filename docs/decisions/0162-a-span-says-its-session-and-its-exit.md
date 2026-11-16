# 0162 A span says its session and its exit

Date: 2026-11-16. Status: accepted (Duke, 07:11,
07:49 and 12:07 UTC).
Adds to: ADR 0119 (the hose), ADR 0159 (exits).
Keeps: ADR 0076, 0040, 0039 (traces as they are).

## What the user said

- 07:11: "session.id attribute, no span".
- 07:49: "Raise the cap by 64 B", so both parts
  land.
- 12:07, on "Accept +1.2% to +2.0% on runs with
  a tap on, then land?": "Accept, land and
  release".

## Context

Devtools will be a plain capsule: the six hooks
and `tap({ export })`. Two facts were out of its
reach.

1. A span did not say its session. A capsule
   could not put a run under the session it ran
   in.
2. A run hook could not tell an rpc refusal
   honestly. Core marks a `Refused` with a symbol
   only `rpc-lifecycle.ts` held. The CLI's `exits`
   capsule reads the symbol's description.

The precedent for 1 is the OpenTelemetry
attribute `session.id`. A backend groups spans by
it, and no span holds the session.

A first try gave each session its own span. It
cost 119 B, and every run in a session then
shared one trace for the session's life. A tab
open for hours made one trace for hours (the case
ADR 0076 names). So no session span.

## Decision

1. **`session.id` on a span.** With a tap on, a
   session gets an id when it opens. Each span
   opened in it carries
   `attributes["session.id"]`.
   - The id is a number from a counter on the
     root. Its first session is 1.
   - A nested session's spans carry the
     innermost id.
   - A tagged call (ADR 0038) keeps its session's
     id. Under `session` hooks a tagged call is a
     session, so it has its own.
   - The root's spans carry none.
   - No tap: no id, no work.
2. **An exporter makes it OTel's shape.** OTel
   types `session.id` as a string, and a counter
   repeats across roots and processes. A sink
   writes it as a string, with a name for the
   root (for example `service.instance.id`).
3. **`Scope.Handle.id`.** The handle reads the
   session's id. A `session` hook reads
   `handle.id` at open and at close, so a capsule
   pairs a session with its spans. The root, and
   a session opened with no tap, read
   `undefined`.
4. **`tinker.exit` on an operation span.** An
   operation span that ends `ok` carries
   `attributes["tinker.exit"]`:
   - `"refused"` for a `Refused`;
   - else the answer's `kind`, when it is a
     string;
   - else nothing, for a plain value.

   These are the exits of ADR 0159, less
   `value`. A read that throws (a `kind` getter,
   a Proxy trap) names no exit, and the run goes
   on as if nothing read it.

5. **The refusal brand.** It moved to
   `src/refused-symbol.ts`, so Core can read it.
   The package entry does not export it. ADR 0019
   says a brand stays in one module; this one is
   shared by two, as `presetSym` is.
6. **The cap.** Core without rpc rose by 64 B,
   from 23168 B to 23232 B gzip.

## Sizes

Measured with `vp run size` (Core without rpc):

- main before (ac3f00cc): 23058 B.
- `tinker.exit` alone: 23128 B (+70).
- `session.id` and `Scope.Handle.id` alone:
  23134 B (+76).
- both, as landed: 23202 B (+144), so 30 B
  under the new cap.

## Not taken

- **A session span** (+119 B): one trace per
  session life, and a parent that is exported
  only at the close.
- **A link to the parent session** (+37 B). OTel
  has no field for it. `session.previous_id`
  means a session that replaced an older one. A
  name would be `tinker.session.parent_id`.
- **A random session id.** Unique across
  processes, but each draw moves the seeded span
  ids.

## Cost

- No tap: no work. A session reads one flag at
  open. A tagged call reads nothing: its frame
  reads the id through a getter, only when a
  span opens.
- Tap on: a span keeps the id in a field and
  writes `session.id` into `attributes` on first
  read. `closeSpan` reads an answer only when the
  value is an object.
- Queued bench on the landed code, `N=61`,
  against main `ac3f00cc`:
  - `session`, `tagged`, `lifecycle`: no
    difference we can see.
  - `op`: no difference we can see on a re-run
    (one run said +0.8% at p=0.04; a main-vs-main
    control was clean).
  - Tap on: `opobs` +1.2% and `opobssession`
    +2.0%, b is slower. The span's one more field
    is most of it; the exit read is the rest.
- Duke accepted the tap-on cost (12:07). The
  precedent: `opobs` +4% was accepted on
  2026-09-30 as the cost of trace ids.

## Consequences

- A `scope`-target resource built for session A
  carries A's id, though the root owns it.
- The CLI's `exits` capsule can read
  `tinker.exit` in place of the symbol's
  description, once it taps the hose.
