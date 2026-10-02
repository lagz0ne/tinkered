# tinkered

Core and React are the two Tinker libraries.
Start feature code uses data, tags, resources, and operations.
The [Start scaffold](apps/start-scaffold/README.md) has public pages,
private lists, SSE sync, and local Victoria trace and log storage.

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

// `sleep` waits on the same clock; pass `ctx.signal` so a forced close cancels it.
const nap = operation({
  label: "nap",
  run: (_deps, { clock, signal }) => clock.sleep(1_000, signal),
});
const woke = scope.run(nap);
clock.advance(1_000); // resolves `woke`
await woke;
const count = data({ label: "count", initial: 21 });
const doubled = scope.run(
  { depends: { count }, run: ({ count }, { input }) => count + input },
  { input: 21 },
); // inline: same call object, one span
await scope.close();
```
