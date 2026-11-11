# tinkered

Core and React are the two Tinker libraries.
Apps are built from
[tinker-app](https://github.com/lagz0ne/tinker-app),
which needs only `@tinker/core` and `@tinker/react`.

Start (the base, its scaffold, and the `tinker` CLI) was sunset
on 2026-11-01 ([ADR 0122](docs/decisions/0122-start-sunset.md)).
Its code lives in tag `start-archive`.
Old `start-v*` releases stay downloadable.

[Authoring packages and apps](docs/best-practices.md)
explains units, owners, and namespace instances.

## Development

- Check everything is ready:

```bash
vp run ready
```

- Run the tests:

```bash
vp run -r test
```

- Build the monorepo:

```bash
vp run -r build
```

- Run the development server:

```bash
vp run dev
```

## `@tinker/core`: the edge picks where a write lands

Since 0.12.0 (ADR 0126). The cell declares no place.
Each `depends` edge names one:

```ts
const token = data({ initial: null });

depends: {
  own: token.controller, // caller's layer
  ns: token.atNamespace.controller, // root, caller ns
  all: token.atScope.controller, // root, no ns
}
```

A write from a session or a `signal` call stays in
that call, unless its edge says `atScope` or
`atNamespace`. The site's Sessions study (`/sessions`)
shows all three. Details:
[Placed edges](packages/core/README.md#placed-edges).

## `@tinker/core`: time is an ambient capability

Every operation and resource ctx carries a `clock`. The default is the system clock; a scope can
be seeded with a controllable one, so time-dependent code is tested with no `Date` mock and no
fake timers (ADR 0034). Nothing below needs a cast; see `examples/core/basic.ts`.

```ts
import { createScope, data, operation } from "@tinker/core";
import { makeTestClock } from "@tinker/core/testing";

const stamp = operation({
  label: "stamp",
  run: (_deps, { clock }) => clock.currentTimeMillis(),
});

const clock = makeTestClock({ now: 1_000 });
const scope = createScope({ clock });
scope.run(stamp); // 1000

clock.advance(500);
scope.run(stamp); // 1500

// `sleep` waits on the same clock; pass `ctx.signal`
// so a forced close cancels it.
const nap = operation({
  label: "nap",
  run: (_deps, { clock, signal }) =>
    clock.sleep(1_000, signal),
});
const woke = scope.run(nap);
clock.advance(1_000); // resolves `woke`
await woke;
const count = data({ label: "count", initial: 21 });
const doubled = scope.run(
  {
    depends: { count },
    run: ({ count }, { input }) => count + input,
  },
  { input: 21 },
); // inline: same call object, one span
await scope.close();
```
