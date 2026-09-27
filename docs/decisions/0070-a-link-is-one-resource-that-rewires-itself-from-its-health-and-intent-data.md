# 0070 A link is one resource that rewires itself from its health and intent data

Date: 2026-09-27. Status: proposed. Builds on: 0048 (transport is userland), 0051, 0060 (an
integration is an extension the scope owns). Evidence:
[survey](../roadmap/jev-handrolled/2026-09-27-survey.md),
[bridges](../roadmap/jev-handrolled/2026-09-27-bridges.md).

## Context

The tracker's tab wire (`apps/issue-tracker/src/client/connection.ts`) hand-rolled what tinker
gives: a status getter plus `onStatus`, listener sets, `settled`/`closed` flags, a promise queue,
an id from `Math.random()`, all built before the scope. A `liveness` resource copied its status
into the `connection` cell, and a `reconnect` operation wrote the same cell around
`line.reconnect()`: one fact, three writers. A survey of the apps and examples found 87 such
places; all 10 that break the rule below were this one wire.

The user (2026-09-27): the connection is just data; reconnecting is a resource that rewires when
it sees a disconnect in that data. Controlling async dependency is what tinker is for, so nothing
needs to exist before the scope.

## Decision

The precedent is a Kubernetes controller: it compares the observed state with the wanted state and
acts until they match, instead of taking commands. An OTP supervisor restarts a child the same way.

**The rule, for raw I/O:**

1. Raw I/O lives in the unit whose lifetime it shares. A resource (or one run) opens it, writes its
   own cells, and `ctx.defer` closes it.
2. An extension bridges only what needs the scope: outside events that open sessions or run
   operations. It resolves the raw unit; it never builds it before `createScope`.
3. A status has one writer: its owner. No getter plus `onX`, and no second unit copying it.
4. Only what a library contract demands stays hand-kept, inside the unit that fulfils it (the
   listener sets behind `Sync.Transport`).

**The link pattern, for anything that stays connected and can drop** (a stream, a socket, a child
process, a pool):

- **Health is data.** One cell holds the observed state (`connecting`, `live`, `dropped`,
  `failed`). Only the link's resource writes it.
- **Intent is data.** An action that wants a reconnect writes an intent cell (a retry count). It
  never calls the link.
- **The link is one resource.** It owns the raw handle (id from `ctx.random`, `ctx.signal`,
  `ctx.defer`). It watches its health and intent cells and rewires: on `dropped` it waits with
  `ctx.clock.sleep(backoff, signal)` and opens again; on new intent it opens now.
  A close aborts the wait, and the link ends quietly.
- **Consumers get a steady handle** from the resource. It always reaches the current raw handle,
  so a consumer never notices a rewire.

## Application case: the tracker's tab wire

```ts
const health = data<Health>({
  label: "wire.health",
  initial: "connecting",
});
const retry = data({ label: "wire.retry", initial: 0 });

const wire = resource({
  label: "wire",
  depends: { health: health.controller, retry: retry.controller },
  factory: ({ health, retry }, ctx) => {
    let es: EventSource | undefined;
    const open = () => {
      es?.close();
      es = new EventSource(url(ctx.random.uuid()));
      es.onopen = () => health.set("live");
      es.onerror = () => health.set("dropped");
    };
    ctx.defer(
      health.watch(async (h) => {
        if (h !== "dropped") return;
        await ctx.clock.sleep(backoff, ctx.signal);
        open();
      }),
    );
    ctx.defer(retry.watch(open));
    ctx.defer(() => es?.close());
    open();
    return transportOver(() => es);
  },
});

const reconnect = operation({
  label: "reconnect",
  depends: { retry: retry.controller },
  run: ({ retry }) => retry.update((n) => n + 1),
});
```

Gone: `liveness`, `reopen`, the status getter and `onStatus`, the flags, the queue, the second
and third writers of the connection status.

## Options considered

- `ctx.release(wire)` from a `reconnect` operation, rebuilding the resource: rejected. It needs a
  new core API, and the operation still commands the link instead of stating intent.
- The link built before the scope and handed in: rejected; it cannot use `ctx`, cells, or
  `defer` (the old wire).

## Consequences

- The checks enforce it: S20 (raw random), S21 (raw clock), S23 (a hand-made `onX`), S24 (raw
  `fetch`), and the judge `bridgesOwnStatus` once it has 5 true labels.
- Best-practices rule 13 loses its "a transport that reconnects is the exception" clause.
- Open: whether sync's `subscribe` takes its transport from a resource inside the scope (today it
  takes a built object, so the tracker still hands it a steady adapter at the root).
