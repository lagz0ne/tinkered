# 0151 A capsule slot arrives as `depends` delivers it

Date: 2026-11-13. Status: proposed (point 1
accepted by Duke, 08:21 UTC; not built).
Changes: ADR 0120, 0121 (slot keys). Matches ADR
0150 (a derived slot).

## What the user said

Duke, 08:04: "if the config receiving a slot, and
it is core primitives (like resource, operation),
it'll be delivered as it comes from the depends. As
such, if we want to change the "backend", let's say
a logger, we'll config to have a dependency on
resource logger, and it comes as the logger".

Duke, 08:07: "maybe we support operation as well,
given that'll be more like a backend ... And we
should even support an array of that, for example
in the case of router capsule".

Duke, 08:21: "we can also make the current capsule
to have the same capability, why not, that'll be a
better quality of life. If they want to have more
control, be it, use controller, etc rather than
bared one".

## Context

A slot key is a config key whose tag holds a unit.
Today a unit that depends on that tag gets the
handle, not the value. The library's start hook
loads it or runs it by hand.

```ts
const logger = tag<Resource.Handle<Logger>>(
  { label: "app.logger" });
const audit = operation({
  depends: { log: logger },
  run: ({ log }) => log.info("saved"),
});
// today: log is the handle; log.info fails
```

drizzle-pg in the template works around it, at
line 30: "A tag cannot name a resource yet (Core
gap), so a cell carries the value."

A derived slot already arrives as its value (ADR
0150, point 10). So one word, slot, has two rules.

Capsule slots already take an operation
(`capsule-config.test.ts`, "a slot key holds an
operation") and a list (`tag.all`).

## Precedent

- **Guice.** `bind(Logger.class).to(Pino.class)`.
  The class asks for `Logger` and gets the built
  one.
- **Effect.** A service is a `Context.Tag`; a
  `Layer` provides it. The code reads the service,
  not the layer.
- **Spring.** Inject by interface; the container
  picks the bean.

## Decision

1. **A slot arrives as `depends` delivers it.** A
   unit that depends on a slot tag gets what it
   would get from the unit in that slot:
   - a resource: its built value (ADR 0044);
   - an operation: a subflow, to call;
   - a cell: its value;
   - a read or a capsule export: a reader.
2. **More control is the controller edge.** A unit
   that wants the handle's controls asks for them,
   as with a bare unit today. The edge on a slot
   tag is open (see below).
3. **A list slot gives a list.** `tag.all` of slots
   gives each item as `depends` delivers it.
4. **The start hook keeps `load` and `run`.** They
   still take a handle. Nothing breaks.

## Where ours is simpler

- No second container. The tag is the interface,
  the cmd's call is the binding.

## Not decided

- **The controller edge on a slot tag.** For
  example `logger.controller`. Next question.
- **An operation in a derived slot.** A derived
  computes again on each change. An op that writes
  can loop. Core could refuse an op whose `depends`
  hold a write edge.
- **A list in a derived key.** Order counts:
  `[a, b]` and `[b, a]` are two entries.

## Proof owed

- A test: a unit that depends on a resource slot
  gets the value; a preset on that resource reaches
  it.
- A test: an op slot gives a subflow; a list slot
  gives values in order.
- drizzle-pg and drizzle-sqlite drop the cell that
  carries the connection.
