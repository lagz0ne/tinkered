# @tinker/core — Extensions

An extension is middleware over the scope's verbs (ADR 0050). Declare it with
`extension({ label, start, close })`, install it at the composition root with
`createScope({ extensions })`, wait with `await scope.ready`, and read its
value with `scope.resolve(ext)`.

```ts
import { createScope, extension } from "@tinker/core";

const events = extension({
  label: "events",
  start: (scope, ctx, next) => {
    ctx.defer((end) => console.log("closed:", end.status));
    return next().then(() => ({ connect: () => true }));
  },
  close: (opts, next) => next(),
});

const scope = createScope({ extensions: [events] });
await scope.ready;
scope.resolve(events).connect();
await scope.close({ graceful: true });
```

A `resolve` hook wraps snapshot reads on the root handle (first registered is outermost; skip
`next()` to short-circuit with a substitute):

```ts
const gate = extension({
  label: "gate",
  resolve: (target, next) => (allowed ? next() : "denied"),
});
```

A `run` hook wraps operation calls on the root handle (first registered is outermost; skip
`next()` to refuse a call with a substitute):

```ts
const audit = extension({
  label: "audit",
  run: async (_op, _call, next) => {
    console.log("before");
    const out = await next();
    console.log("after");
    return out;
  },
});
```

Await `ready` before the first `resolve(ext)`.

A `write` hook wraps cell writes on the root handle (first registered is outermost; skip
`next()` to refuse a write, leaving the value and watchers unchanged):

```ts
const even = extension({
  label: "even",
  write: (_cell, value, next) => {
    if (typeof value !== "number" || value % 2 === 0) next();
  },
});
```

A request's reads, calls, and writes are not wrapped yet: sessions created from an extended
scope read, run, and write with the plain dispatch (the v1 limit). A write that reaches the cell
through a `depends: { x: cell.controller }` edge inside an operation runs on the layer directly
and is not wrapped either (the v1 limit).
