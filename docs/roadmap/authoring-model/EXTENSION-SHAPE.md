# Extension access, derived from cases

Date: 2026-09-30.
Status: saved and tested on `authoring/model-fixes`; Core size gate is red.

## Rules

- Tags are static settings.
- Data is mutable state.
- Resources provide reusable values, setup, and cleanup.
- Operations are actions.
- Namespaces select instances.
- Scopes and sessions own their lifetime.
- The declared graph stays fixed.

The precedent is this repo's middleware and resource model.
Middleware wraps an action with `next`.
A resource owns setup and cleanup (ADR 0050, 0063, and 0070).

## One event object

New hooks receive one object.
Its `kind` tells TypeScript which fields it has.
Adding a field does not change the order of arguments.

```ts
import * as http from "@tinker/http";

const engine = extension({
  label: "http.engine",
  hooks: {
    run(event) {
      if (event.op !== http.send) return event.next();
      return manage(event);
    },
  },
});
```

The engine subscribes only to the hook kinds it uses.
Core makes an event only for a matching object hook.
Access functions are made and kept on their first read.
Passing through with `event.next()` does not build them.

Each kind adds these fields to the common access:

```text
start   { kind, scope, next }
session { kind, handle, next }
run     { kind, op, call, next }
resolve { kind, target, next }
write   { kind, cell, value, next }
close   { kind, options, next }
```

`Scope.ExtensionEvent` is the union of those shapes.
`Scope.ExtensionEvents["run"]` names the run shape.
Common fields include `ns`, `resolve`, `controller`,
`run`, `settle`, `signal`, `defer`, clock, and random.

Existing top-level callbacks keep their arguments.
When both forms supply the same hook, `hooks` wins.

## Case 1: one HTTP engine, two clients

GitHub and Cloudflare share `http.send`.
Their namespace tags choose settings and engine control.

```ts
const managed = tag({ default: false });
const active = data({ initial: 0 });
const ghUrl = "https://api.github.com";
const ghConfig = http.config({ baseUrl: ghUrl });
const ghTags = [managed(true), ghConfig];
const github = namespace({ tags: ghTags });
const cloudflare = namespace({
  tags: [
    managed(true),
    http.config({
      baseUrl: "https://api.cloudflare.com/client/v4",
    }),
  ],
});

async function manage(event: Scope.ExtensionEvents["run"]) {
  if (!event.resolve(managed)) return event.next();
  const count = event.controller(active);
  count.update((n) => n + 1);
  try {
    return await event.next();
  } finally {
    count.update((n) => n - 1);
  }
}
```

The count belongs to the actual calling session and key.
Inherited namespaces and per-call overrides both work.
A tagged call uses the same child for hooks and body.

Graceful close waits for the whole hook and its cleanup.
Forced close aborts it and refuses a late `next()`.
Resources read by a run hook stay held through its cleanup.

## Case 2: save and restore a transcript

Tinkerer now declares persistence once.
Each namespace binds its file through a tag.
Its transcript resource owns restore, watch, and cleanup.

```ts
const history = persistence({ frame: coder });
const reviewer = namespace({
  tags: [history.file("./reviewer.jsonl")],
});
const scope = createScope({
  extensions: [history.extension],
});
const session = scope.createSession();
session.resolve(history.transcript, { ns: reviewer });
const box = session.controller(coder.messages, {
  ns: reviewer,
});
box.update((saved) => {
  const next = [...saved];
  next.push({ role: "user", content: "Review the diff" });
  return next;
});
```

Opening a session prepares its inherited namespace.
A run prepares its selected namespace before its body.
A direct set prepares that namespace before the write.
A namespace without a file tag does not save messages.

Reads do not prepare a transcript.
Resolve the resource before a direct read or update
in a namespace that has not run yet.
An update reads before it writes; setup at the write is too late.
A direct set still replaces the whole message list.

The legacy `persist({ frame, file, ns })` call stays valid.
It prepares sessions only, as before.
Transcript editing and file locking remain separate work.

## Case 3: share directory management

GitHub and Cloudflare can keep separate clients
and use one directory service.
Resource targets already express the sharing:

- `session`: one value per asking session and key.
- `namespace`: one root-owned value per key.
- `scope`: one root-owned value, ignoring the key.

```ts
const shared = await event.resolve(directories);
```

If `directories` targets `scope`, both clients get it.
Closing a child ends its session-target clients.
Root-owned services live until the root closes.
An event cannot change a resource's target.

## Case 4: an action drives another agent

An operation still declares its known dependencies.
A hook can also start an action under its current run:

```ts
await event.run(coder.turn, {
  ns: reviewer,
  input: "Review the draft for missing steps.",
});
```

The action keeps its parent, failure, and close rules.
`event.settle` uses the existing recovery rule.
Calling the intercepted operation re-enters its hooks.
Use `event.next()` to continue the intercepted call.

An `ns` override changes the key in the current session.
It does not jump to a persistent sibling session.

## Case 5: outside messages and shutdown

NATS now declares one bus and binds connection settings.
The driver keeps root state in a scope-target resource.
Each connection lives in a namespace-target resource.

```ts
const bus = nats(rows);
const east = namespace({
  tags: [bus.config({ url: eastServer.url })],
});
const west = namespace({
  tags: [bus.config({ url: westServer.url })],
});
const scope = createScope({
  ns: east,
  extensions: [bus.extension],
});
await scope.ready;
await scope.run(bus.publish, { ns: west, input: message });
```

The same publish operation selects the right connection.
Resolve `bus.connection` to start an incoming-only key.
Its plain handle keeps the NATS library inside the module.
`Resource.Ctx.ns` lets incoming messages retain their key.
Closing a child leaves these root-owned connections live.

The close event reads its own root's driver state.
It stops incoming subscriptions before resource cleanup.
NATS no longer replaces `scope.close`.
Constructor settings remain a fallback for old calls.
One bus definition can serve independent roots.

Sync uses the same owner rule for transport state.
Stack stores its publisher controller on its owning root.
A committed session calls that root after commit.

## Limits and proof

Resolve hooks wrap direct root reads only.
Session reads, dependencies, and event access bypass them.
They cannot promise setup on every read.

Extensions hold declarations and hooks.
Live state belongs to resources or data on each owner.
Namespaces need no start, stop, or disposal API.

New regression tests cover namespace access, tagged calls,
hook waits, resource holds, direct persistence writes,
independent roots, and real NATS server routing.
The [progress log](PROGRESS.md) records gates and measurements.
Queued probes found no difference between legacy and object hooks.
They also found no slowdown on the path with no hooks.
Core still exceeds its size cap; landing waits for that gate.
