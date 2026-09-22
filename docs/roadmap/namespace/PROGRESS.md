# namespace — design record (ADR 0059, proposed)

A parallel storage keyed by a branded value; the invocation carries `ns`. Not built. This holds the
use-case census and the probes so the design does not evaporate before it is scheduled.

- **Decision:** `docs/decisions/0059-*.md`.
- **Precedent:** Effect `LayerMap` + `RcMap` (one Layer template, keyed instances, refcounted map).
- **Status:** grilled to convergence 2026-09-22; blocked on the two open probes below before a ticket.

## The use-case census (from the repo)

Every isolation point, classified by axis. Storage-only dominates; the axes are non-mutual.

Lifetime (parallel data per unit of work) -- served by sessions today:

- hono per-request, drizzle tx, sync subscriber, mcp/turn

Storage (same graph, N storages) -- the `label` axis:

- github vs stripe, tinkerer's own `.http` -- faked by a frame label
- per-tenant, same tools -- UNSERVED

Graph (which units run):

- hono `path -> op`, process `name -> route` -- served, static key

Both storage and graph:

- per-tenant with its own tools -- UNSERVED

The unserved cells are the dynamic column. `label` is the storage axis with no key of its own.

## The probes (packages/core, throwaway)

1. **Sessions ARE namespaces.** Two sibling sessions, one session-target `client` resource on a
   `config` tag: one build per session, isolated cell state, dynamic creation, persists until closed.
   Four of five needs already met. (A scope-target resource cannot see a session tag -- that is why
   every frame uses `target: "session"`.)
2. **The gap.** One op relaying A<->B works as a plain function holding both handles, but that is
   outside the graph (no trace). As an op it cannot address the standing A/B -- a tagged call makes a
   fresh child, not the persistent sibling. This is the whole reason for the ADR.

## Settled surface

```text
namespace()               mints a branded key
turn.run({ input, ns: a }) a subflow, in namespace a
scope.resolve(cell, { ns: a })  a scope verb, same object
scope.controller(cell, { ns })
ns: a | [a, b]  read-through chain (layer-shadow sideways)
storage (layer, ns, unit), refcounted (RcMap)
```

## Design iteration 2026-09-22 (probes 3-7)

Ran the common authoring cases through a userland prototype (sessions + a `(layer, ns, unit)` store).
Hunting for gaps and two-ways -- the good design has one expression per problem.

- **1 single (default) ns** -- omit `ns`. One way.
- **2 github/stripe config** -- `namespace({ tags })`. Resolved (was two ways).
- **4 A<->B relay** -- per-call `ns` on the subflow, which keeps `relay` as the span
  parent. One way; `ns` must NOT be a session (a session re-parents the span).
- **5 fallback (override one setting)** -- write what differs, read through the chain. One way.
- **6 shared resource** -- `target: "scope"` is shared across every namespace; `target: "session"`
  is per namespace. Resolved: the existing `target` setting is the axis, no new marker. Probed: one
  pool, two clients, both holding the one pool.
- **7 "all work in tenant"** -- ambient `ns` on the session, per-call `ns` overrides. Resolved
  (was two ways): ambient + override, the same shape as tags.

Two design points the probes forced, now in the ADR:

- **ns is not a session.** A session is a new layer (changes span parent + storage); a namespace
  keeps the layer, changes only the storage bucket. Running a subflow via a session handle re-parents
  its span, breaking `relay > a:turn`. This is the core change no primitive can fake.
- **ambient + override.** `createSession({ ns })` for "all work in a tenant"; per-call `ns` for "touch
  two at once". Same shape as tags. Removes the per-call-only trap.

CASE 6 (a per-namespace resource with a shared sub-dep) closed on 2026-09-22: `target` already
says shared (`scope`) versus per-instance (`session`); stretching it one step to namespaces makes
the case one way. Probe output: `pools built: 1  clients built: 2`.

## Open probes -- do these before a ticket

- **Refcount release timing:** last-borrow vs idle grace; does a resource `defer` in a released
  namespace run on release or on layer close?
- **`ns` chain x session chain order:** a cell written at a parent layer in ns `b`, read from a child
  with `ns: [a, b]` -- which chain wins.

## When scheduled

One core generalisation (`nodeState` keyed by `(layer, ns, unit)`, the invocation `ns` attribute,
`namespace()`), then frames drop `label` (retires the ADR 0057 factory-with-label pattern), then the
A<->B multi-agent example as the golden proof.

## Core spike result 2026-09-22 (branch probe/ns-spike, tag probe/ns-spike-v1, PARKED)

A muse writer built `(layer, ns, unit)` in real core (+703 net lines), 392 core tests green (385 old

- 7 new). An xhigh judge (astra) then found the spike does NOT cleanly answer the two probes -- it
  has real correctness holes, and its own tests lock a rule the report misstated:

* Chain order: cells search named buckets across ALL layers before defaults; resources check only the
  chain head at the current layer. They disagree. A test asserts a far named beats a near default
  (namespaces-first) while the report claimed "layers first". Unresolved -- see ADR 0059 criteria.
* Release under-waits: the dependency-graph walk freed a `pool` a live `client` still used.
* Scope-target build saw the `ns` chain -- tenant tags leaked into the shared default (breaks CASE 6
  in code).
* Ambient `ns` was dropped by child sessions, tagged subflows, inline ops, and imperative controllers.

Value: the spike de-risked by finding the hard parts. The two open probes are now written as concrete
acceptance criteria in ADR 0059. The branch stays as a reference; it does NOT land. A real ns ticket
starts from those criteria, not from this spike's code.

Lesson: probe tests written against a buggy build "prove" the build. The judge caught a test that
locked the wrong chain order -- run the judge before recording a rule as settled.
