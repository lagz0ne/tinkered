# 0163 Devtools is a capsule

Date: 2026-11-18. Status: accepted (Duke,
2026-11-16).
Builds on: ADR 0050 (the hooks), ADR 0119 (the
hose), ADR 0162 (`session.id`, `tinker.exit`).

## What the user said

- 2026-11-16: devtools is a plain capsule that
  the scope lists. No global hook, no
  `scope.inspect()`, no Core change.
- The record is Core's `Observe.Span`, as
  `tap({ export })` gives it. No second record
  type.
- The CUJ work (ADR 0159) owns
  `localStorage["tinker.exits"]`. Devtools reads
  it later and writes no copy.
- Prefer less API.

## Context

A devtools view needs four facts about a running
scope:

1. its life: starting, ready, closing, closed;
2. its sessions, open and closed;
3. its runs, under the session they ran in;
4. its cell writes.

ADR 0162 gave the two facts a capsule could not
reach: the session of a span, and the exit of a
run.

## Precedents

- **React DevTools** reads a global hook,
  `__REACT_DEVTOOLS_GLOBAL_HOOK__`. React needs
  it: React has no place where a tool installs
  itself. Tinker has one: `capsules`. So no
  global hook.
- **TanStack Query** gives `QueryCache.getAll()`
  and `subscribe()`. Devtools has the same pair:
  `snapshot()` reads all, `moves(fn)` hears each
  change.
- **OpenTelemetry** groups spans by the
  attribute `session.id`. Devtools groups runs
  the same way.
- **The DOM `EventTarget`**: a listener that
  throws is reported, and the other listeners
  still run.

## Decision

1. `@tinkered/devtools` is a new package. It
   ships with the other `@tinkered` packages, at
   one version.
2. `devtools(options?)` returns a new capsule on
   each call, with its own state. One call serves
   one scope.

   ```ts
   const dt = devtools();
   createScope({ capsules: [dt] });
   dt.snapshot();
   ```

3. It uses only Core's hooks and one tap:
   - `start` and `close` give the scope's life,
     and the close status;
   - `session` gives each session by
     `handle.id`, and its close status;
   - `write` counts each write by cell label;
   - the tap gives each span when it ends.
4. Spans sit in one ring of `limit` spans
   (default 1000). The oldest goes first.
5. `snapshot()` gives a plain object:
   - `scope`: its state and close status;
   - `sessions`: each with its own runs;
   - `runs`: the root's runs;
   - `resources`: the resource spans;
   - `writes`: label and count; the value only
     with `values: true`;
   - `exits`: `label<tab>exit` to a count, the
     key shape of ADR 0159.
6. `moves(fn)` calls `fn` on each new record. It
   returns the call that stops it.
7. A listener that throws does not stop a run.
   Devtools throws its error again in a
   microtask.

## Not in this cut

- A CLI command, `tinker state`.
- A span log in IndexedDB that outlives a page.
- A React panel.
- Reading `localStorage["tinker.exits"]`.

## Consequences

- A scope that does not list devtools does no
  devtools work.
- A scope that lists it pays for a tap on, as
  ADR 0162 measured.
- An app picks where the data goes: a panel, a
  file, or a test.
