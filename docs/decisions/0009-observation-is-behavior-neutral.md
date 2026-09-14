# 0009 Observation is behavior-neutral; automatic tracking is operation-grained

Date: 2026-09-14. Status: accepted.

## Context

The engine observes its own work as spans that nest into a tree. An earlier
prototype auto-wrapped every resolved resource's methods in a `Proxy` whenever
observation was enabled (with an `untraced` tag to opt out). Three independent
design reviews found this makes observation _change program behavior_: the proxy
changes object and method identity, and for fluent, lazy clients (e.g. Drizzle)
it awaits the query builder early and breaks the chain. The core is meant to stay
small, with per-client knowledge living in integration modules.

## Decision

- Observation is **behavior-neutral**: the core never proxies or wraps a
  user-provided value or a resource's methods. Turning observation on, or adding
  an exporter, cannot change results or value identity.
- Automatic tracking is **operation-grained**: resolving an operation (and
  resolving a resource) opens a span automatically when observation is enabled.
  No annotation is needed to see the operation tree — operations are tracked by
  default. We do not auto-observe arbitrary method calls inside a resource.
- Finer-grained tracing of a client's own calls (SQL, HTTP) lives in integration
  adapters, or is opted in explicitly at the call site with `ctx.obs.span(...)`.
- Exporting, retained history, logging, and client instrumentation are
  **independent** switches. Exporter callbacks are isolated: a throwing sink never
  fails application work. Retained history is bounded or off by default.
- The `untraced` tag and the auto-proxy path are therefore **removed** from core.

## Consequences

- Fluent/lazy clients are safe; observation never breaks them.
- Integration modules (`@tinker/drizzle`, `@tinker/http`, …) own their span
  attributes (`db.statement`, `http.*`) and instrument at the real execution seam.
- Cost when observation is off stays a single boolean per span site.
- Follow-up code change in `scratch/tinker.ts`: delete `untraced` and the
  `wrapRes`/`instrument` auto-proxy; keep operation/resource resolve spans,
  `ctx.obs.span`, and the `onStart`/`onEnd` extension hook.
