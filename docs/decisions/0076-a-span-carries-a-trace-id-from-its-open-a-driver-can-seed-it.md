# 0076 A span carries a trace id from its open; a driver can seed it

Date: 2026-09-29. Status: accepted (direction; the shape is set in its core ticket). Builds on:
0009 (observation is behavior-neutral), 0058 (the graph produces the trace), 0061 (a log line
carries a level), 0062 (random is ambient), 0074 (the stack). Research:
`docs/roadmap/stack-v1/RESEARCH.md`, round 2.

> Superseded in part by 0086 (2026-09-29): ids draw from a private stream, not the ambient random.

## Context

The user wants the stack to speak OpenTelemetry for logs and traces.

Today a span has a numeric `id`, counted per root scope, and a `parentId`. `export` sees spans
child first, as they close. So a sink cannot know which trace a span belongs to until its root
closes. A sink alone would hold every open trace tree in memory, and an SSE session can stay
open for hours. Nothing reads or sends the W3C `traceparent` header, so a trace cannot cross
from a caller into our server, or from our `http` client into another service.

**The precedent is W3C Trace Context and OpenTelemetry's span model.** A trace id is set at the
root and copied to every child when it opens; the carrier (a header) seeds a new root's parent.
Ours is simpler: core only carries the ids; the conversion to OTLP lives in a sink in the stack.

## Decision

1. **A span knows its trace from the moment it opens.** A child copies its parent's trace id.
   A root span gets a new one.
2. **A driver can seed a session's trace** and remote parent. `hono` reads `traceparent` from
   the request; `@tinker/http` sends it on the way out.
3. **Core imports no OTel package.** The OTLP sink is `@tinker/stack`'s. The OTel logs SDK is not
   used while it is marked "Development"; the sink maps a log's level to OTel's severity number
   (20→5, 30→9, 40→13, 50→17).
4. **Off stays free.** With observation off, no id is made (ADR 0009's one boolean). New ids come
   from the ambient `random`, so a test with a seeded `random` gets the same ids every run.
5. **The core ticket settles the shape**, with an impact block (ADR 0065) and timing through
   `bench/queued.sh`: the id format, whether a span also carries a kind hint (server, client,
   job) and links (a job to the request that added it), and the `service.name` source.

## Consequences

- A cross-package change: core, `hono`, `http`, and every span-tree test that prints spans.
- The OTLP sink can stream each span as it closes, with no tree held in memory.
- The observation-on scenarios must stay inside their budgets.

## Options considered

- **A sink only, no core change.** Rejected: it holds whole trees until the root closes, and it
  cannot join a trace started elsewhere.
- **`@opentelemetry/api` inside core.** Rejected: its calls cost time on every run even with no
  SDK, OTel spans cannot be read back, so `scope.spans()` and span-tree tests would need a second
  system, and its logs API is alpha.
