# 0105 A shared stack is a resource; a slot is a tag

Date: 2026-10-05. Status: proposed (lead design, card `core/extension-slot`).
Uses: 0051, 0099, 0100, 0101.
Feedback row: "Shared unit with a slot, 2026-10-03".

## Context

The supplier and payment trial services share one HTTP stack
in `tools/flight-trial/services/http.ts`:
call log, token check, body decode, route rules,
control routes, and the listener.

The ~170 copied lines are already gone.
Commits `ca735cf7` and `29785854` (2026-10-03)
moved them into `http.ts`.
Commit `25494878` (2026-10-04) let Hono own each
reply (ADR 0103), so no service action is left to share.

One fault is left.
Each service reaches the stack through a hand call:

```ts
const scope = event.scope.createSession({
  tags: [errorShape("duffel"), wireErrors(errors)],
});
const http = await httpRequests.hooks!.start!({
  ...event,
  scope,
});
```

- Core never starts `httpRequests` as an extension.
- Installed beside an app, it would start a second time,
  on the root, which lacks the service tags.
- The service makes a session only to bind two tags.

The card asked for two Core features:

- (a) one extension includes another;
- (b) a declared unit takes a slot,
  such as the service's own action.

The card's word "slot" means a need the composer fills.
The glossary retired "slot" (ADR 0102).
This decision says "tag" for it.

## Precedent

- **Fastify plugins.**
  A plugin lists its `dependencies` by name.
  Fastify throws when one is missing; it does not load it.
  It never drops a repeat: a second `decorate`
  of one name throws `FST_ERR_DEC_ALREADY_PRESENT`.
  `fastify-plugin` turns off the plugin's own context,
  so its decorations reach the parent.
- **NestJS modules.**
  A module lists `imports`.
  Modules are singletons: two importers share one instance.
  A dynamic module (`register(options)`)
  carries the importer's settings.
- **Effect layers.**
  `Layer.provide(a, b)` builds `b` first
  and fills `a`'s needs from it.
  One layer value used twice builds once;
  `Layer.fresh` opts out.
  A layer's needs (its `RIn` type) are its slots.

What we borrow:

- A slot is a need the composer fills.
  In Tinker that is a tag (Effect's `RIn`, Nest's options).
- Sharing goes by identity: one value, one build.
  A Tinker resource already builds once per layer.
- A dependency starts before its user.

Where ours is simpler:
the stack needs setup at start, and nothing else.
Setup is what a resource factory does.
So we need no plugin tree and no module graph.

## Decision

Core adds nothing.

1. **The shared stack is a session resource.**
   `httpRequests` becomes the resource `requests`,
   like `controlRoutes` beside it.
   Its factory registers the shared middleware.
   A second resolve in one session returns the same
   instance, so nothing registers twice.
2. **The service's start hook keeps the one hand job.**
   It makes its session and puts it on Hono's context.
   Only a hand holds a scope (ADR 0051),
   so these 4 lines stay in each service.
3. **A slot is a tag.**
   The shared units read `errorShape` and `wireErrors`.
   Each service binds them on its session.
   The service's own actions stay Hono routes (ADR 0101).

### `http.ts`

```ts
/** Each service binds its session as `c.var.scope`
 * first; this adds the shared stack once. */
export const requests = resource({
  label: "shared HTTP requests",
  target: "session",
  depends: { http: web, shared: middleware },
  factory({ http, shared }) {
    http.use("*", async (c, next) => {
      c.set("json", shared.json);
      c.set("error", shared.error);
      c.set("respond", shared.respond);
      c.set("control", false);
      await next();
    });
    // control flag, log, token, body, rule:
    // the same five `use` calls as today
    return http;
  },
});
```

### Supplier, before

```ts
async start(event) {
  const scope = event.scope.createSession({
    tags: [errorShape("duffel"), wireErrors(errors)],
  });
  const http = await httpRequests.hooks!.start!({
    ...event,
    scope,
  });
  await scope.run(resetScenario, {
    rawInput: { name: "default" },
  });
  // expireHolds, controlRoutes, routes, listener
}
```

### Supplier, after

```ts
async start({ scope: root, next }) {
  await next();
  const scope = root.createSession({
    tags: [errorShape("duffel"), wireErrors(errors)],
  });
  scope.resolve(web).use("*", async (c, next) => {
    c.set("scope", scope);
    await next();
  });
  const http = scope.resolve(requests);
  await scope.run(resetScenario, {
    rawInput: { name: "default" },
  });
  // expireHolds, controlRoutes, routes, listener:
  // unchanged
}
```

### Payment, before

```ts
async start(event) {
  const scope = event.scope.createSession({
    tags: [errorShape("stripe"), wireErrors(errors)],
  });
  const http = await httpRequests.hooks!.start!({
    ...event,
    scope,
  });
  scope.resolve(controlRoutes);
  // reset, webhooks, keys, routes, listener
}
```

### Payment, after

```ts
async start({ scope: root, next }) {
  await next();
  const scope = root.createSession({
    tags: [errorShape("stripe"), wireErrors(errors)],
  });
  scope.resolve(web).use("*", async (c, next) => {
    c.set("scope", scope);
    await next();
  });
  const http = scope.resolve(requests);
  scope.resolve(controlRoutes);
  // reset, webhooks, keys, routes, listener:
  // unchanged
}
```

### Proof (a probe, not landed)

The lead applied the three changes above,
ran the checks, and restored the files.

- `vp check` in `tools/flight-trial`: exit 0.
- Service tests: 7 files, 84 tests pass, as before.
- Net line change: 0 (41 lines in, 41 out).

### ADR 0099 and 0100 stay true

- No builder: the stack is a declared resource.
  Its per-service values are tags.
- No plain function takes a handle.
  The scope binding is a callback inside the start hook.
- Only `main.ts` files and tests call `createScope`.
- The session belongs to the root and closes with it.
- The Hono app and the listener stay resources.
- No helper exports a scope or a start function.

## Held design: an extension that includes another

Core needs (a) when a shared piece needs a hook
other than `start`: `run`, `write`, `resolve`,
`session`, or `close`.
A resource cannot wrap those; only an extension can.

The smallest API is two fields on `extension()`:

```ts
export function extension<T = void>(config: {
  readonly label: string;
  readonly hooks?: Scope.Hooks<T>;
  readonly extensions?: Many<Scope.Extension<unknown>>;
  readonly tags?: Tag.Bindings;
}): Scope.Extension<T>;
```

Rules:

- `extensions` takes the shape of
  `createScope({ extensions })`.
- An included extension starts first.
  It is the outer layer of each hook chain.
- A repeat of the same object starts once,
  at its first place.
- `tags` bind on the root, under the entry's own tags.
  The entry's binding wins.
- An includer cannot read an included extension's
  value in its own start: the outer start settles last.
  It reads shared things through their resources.

Start order for `extensions: app`:

```text
flatten: [httpRequests, app]
httpRequests.start
  register shared middleware
  await next()
    app.start
      register routes
      return the listener
  settle last
```

Supplier, held design:

```ts
export const app = extension({
  label: "start supplier app",
  extensions: httpRequests,
  tags: [errorShape("duffel"), wireErrors(errors)],
  hooks: {
    async start({ scope, next }) {
      await next();
      const http = scope.resolve(web);
      await scope.run(resetScenario, {
        rawInput: { name: "default" },
      });
      // routes: unchanged
      return scope.resolve(listener);
    },
  },
});
```

Payment is the same with `errorShape("stripe")`.
`httpRequests` registers its middleware before
its own `await next()`, and binds the root scope.

Core, held design:

```ts
function readExtensions(
  input: Many<Scope.Extension<unknown>>,
  out: Scope.Extension<unknown>[] = [],
): Scope.Extension<unknown>[] {
  for (const ext of readMany(input))
    if (!out.includes(ext)) {
      readExtensions(ext.extensions, out);
      out.push(ext);
    }
  return out;
}

// createScope
const exts = readExtensions(options?.extensions);
const layer = makeRootLayer(
  exts.length > 0
    ? {
        ...options,
        tags: [exts.map((e) => e.tags), options?.tags],
      }
    : options,
);
```

### Size, measured

A throwaway copy of Core was built with each step.
The count is the `pnpm validate` count:
gzip of every runtime file the main entry loads.

- now: 16,084 B
- drop repeats only: +7 B
- include, drop repeats: +34 B
- include, drop repeats, tags: +56 B

A probe on the last build:

- `[shared, app]`, where `app` includes `shared`:
  `shared` starts once, outermost,
  and reads the tag that `app` binds.
- An entry tag beats the app's tag.

## Options considered

- **Include and tags now (+56 B).**
  Each service loses its session and scope binding.
  But every extension gets two fields for one caller.
  Core has 300 B left, and another card cuts toward 13 KiB.
- **Include only (+34 B); entries bind the tags.**
  About 65 test roots install a service app.
  Each must add the service tags.
- **A nested list `[httpRequests, supplier]`
  that drops repeats (+7 B).**
  The shared start gets the root,
  which lacks the service tags: the same churn.
- **A builder `httpStack(shape, errors)`
  that returns an extension.**
  The values would sit in a closure, out of the graph.
  Tags carry them where the graph can see them.
- **A production preset that fills an empty operation.**
  Presets are test-only (ADR 0015).

## Consequences

- The fix is a trial change, not a Core change.
  The card's Verify line still holds:
  the hand call goes, and Core tests stay green.
- The feedback row closes at landing:
  "fixed in the trial; Core unchanged".
- The held design waits for its trigger:
  a shared piece that needs a hook other than `start`.

## Open questions

1. **Change Core now?**
   - No (this decision): 0 B.
     Each service keeps a session and 4 lines.
   - Yes, the held design: +56 B.
     Services lose the session and the 4 lines.
   - Lead's pick: no. The strict forms already
     express it (ADR 0099); 56 B is a fifth of the room.
2. **May a tag hold an operation handle?**
   - Yes: a service binds its own operation;
     a shared route runs it. The edge shows at the
     binding and in spans, not in `depends`.
   - No: tags hold plain values; actions stay routes.
   - Lead's pick: no, until a caller needs it.
     The one candidate, `/control/scenario`, is 6 lines,
     and its wire schema differs per service.
3. **If the held design lands: a repeat?**
   - Drop it, by identity (Effect, NestJS).
   - Throw, as Fastify's `decorate` does.
   - Lead's pick: drop. The card asks that installing
     the shared one beside an app starts it once.
