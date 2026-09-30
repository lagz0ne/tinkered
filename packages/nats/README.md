# @tinker/nats

NATS pub/sub as an extension the scope owns.
The app calls operations and receives plain data.
The NATS client stays inside this package.

```ts
import { createScope, operation } from "@tinker/core";
import { nats, subscribe } from "@tinker/nats";
import type { Nats } from "@tinker/nats";
import type { Operation } from "@tinker/core";

const receive = operation({
  label: "receive",
  run: (_deps, ctx: Operation.Ctx<Nats.Message>) => {
    return new TextDecoder().decode(ctx.input.payload);
  },
});
const bus = nats([subscribe("updates.*", receive)]);
const send = operation({
  label: "send",
  depends: { publish: bus.publish },
  run: ({ publish }) =>
    publish.run({
      input: {
        subject: "updates.saved",
        payload: new TextEncoder().encode("42"),
      },
    }),
});
const scope = createScope({
  tags: [bus.config({ url: "nats://127.0.0.1:4222" })],
  extensions: [bus.extension],
});
await scope.ready;
void scope.run(send);
await scope.close({ graceful: true });
```

One `nats(rows)` definition can serve several roots.
Each root owns its connections and subscriptions.
Closing or failing one root leaves the other roots alone.
The definition can start again after a root closes.

Bind settings with `bus.config({ url })` on the root or namespace.
`nats(rows, { env })` still accepts `env.NATS_URL` as a fallback.
A config tag wins over that fallback.
There is no default URL.
The initial config is checked before later starts run.
The URL must use `nats://` or `tls://` and name a host.
The NATS v3 Node client is pinned to 3.4.0.
Each publish sends a subject and byte payload.
Publish returns a promise and queues the bytes.
`void scope.run(bus.publish, { input })` stays tracked by the scope.
Graceful close waits for queued publishes and flushes them.
NATS pub/sub does not save messages for later delivery.

`subscribe(subject, operation)` makes a driver row.
A loader returns the operation when each connection starts.
Use a loader when the operation depends on `bus.publish`.
Each message copies its payload into its own session.
A failed operation writes one error through the scope's
log sink and leaves the subscription open.

A dev host can lend `connection` through `bus.config`
or the old `wiring.connection` fallback.
Its owner must close it after the scopes end.
The piece drains only its own subscriptions on that
connection; it leaves the connection open.

## Named connections

One connection serves each selected namespace until root close.
Incoming messages open sessions in that namespace too.
The root's selected namespace is ready after later starts finish.
Other namespaces start on their first publish or explicit resolve.
The driver never scans for namespaces.

```ts
const east = namespace({
  tags: [bus.config({ url: "nats://east:4222" })],
});
const west = namespace({
  tags: [bus.config({ url: "nats://west:4222" })],
});
const scope = createScope({
  ns: east,
  extensions: [bus.extension],
});
await scope.ready;
await scope.resolve(bus.connection, { ns: west });
await scope.run(bus.publish, {
  ns: west,
  input: {
    subject: "updates.saved",
    payload: new TextEncoder().encode("42"),
  },
});
await scope.close({ graceful: true });
```

Import `namespace` from `@tinker/core` for this example.
`bus.connection` prepares subscriptions as well as sending.
Its plain handle has `send(message)`; no SDK client escapes.
After ready, `scope.resolve(bus.extension)` returns the sender
for the root's initial namespace.
Resolving it without the extension raises `NotStarted`.
Calling its `send` handle after close raises `NotStarted`.
Graceful close stops incoming work and waits for replies
before the scope closes its resources.
Forced close aborts running messages before cleanup.

Trace headers, JetStream, KV, and object store wait for
later tickets.

## Tests need `nats-server`

The test-only `@tinker/nats/testing` entry exports
`installNatsServer()` and `startNatsServer()`.
The first install fetches server v2.15.0 for the host
from the [official release][release].
It checks the archive against the published SHA-256.
Later installs check the saved archive and use the cache.
The default cache is under the user's home:
`~/.cache/tinkered/nats-server/2.15.0`.
A custom cache folder is accepted for damaged-cache tests.
Tests can also supply a download base as the second argument:

```ts
await installNatsServer(cache, {
  downloadBase: "http://127.0.0.1:8080",
});
```

The official GitHub release is the only default download base.
The base is used only when the cache has no archive.
A non-2xx response raises `DownloadFailed` with its `url` and `status`.
A successful response with wrong bytes raises `ChecksumMismatch`.
The helper needs `tar` and network access on first use.

Each server uses a free loopback port and a temp store.
Call `await server.close()` after the test file ends.
It waits for process exit and removes the store.
`server.storeDir` names that store.
`startNatsServer(config)` accepts NATS config for tests.
An invalid config fails startup and removes the store.
`server.monitorUrl` is the loopback monitor used to
check open connections.

```ts
import { startNatsServer } from "@tinker/nats/testing";

const server = await startNatsServer();
try {
  const env = { NATS_URL: server.url };
} finally {
  await server.close();
}
```

## Promises tested

- Publish reaches a subscription operation with its subject and payload.
- Connection setup requires the bus extension on its root.
- Resolving the extension returns its root namespace's prepared sender.
- A shared piece serves independent roots and restarts after one closes.
- Closing a failed root leaves a later root using the same piece alive.
- Namespace config routes publish and incoming sessions through separate connections.
- Resolving a selected connection prepares incoming service without a publish.
- Each message gets its own session resources and closes them.
- A failed operation logs one error and the next message still runs.
- Scope close drains queued messages and their replies before closing the connection.
- A borrowed connection stays open while this scope's subscriptions stop.
- Missing `NATS_URL` fails boot naming the key.
- Bad `NATS_URL` fails boot naming the key.
- The graph traces publish and the subscription operation.
- The helper fetches the pinned server once and reuses its home cache.
- A bad checksum refuses the binary.
- Download errors name the URL and status while bad bytes fail checksum.
- Forced close aborts a running message and closes the connection.
- Close during boot reaps a connection that opens later.
- Failed boot keeps its cause and closes any connection without cleanup errors.
- A started server closes its connections and frees both ports and its store.
- A server that rejects its config removes its store before reporting failure.
- A publish-only scope flushes queued bytes to a peer before it closes.
- A denied subscription logs its subject and closes only an owned connection.
  Graceful close returns `{ status: "success" }` with no teardown errors,
  for both owned and borrowed connections.

[release]: https://github.com/nats-io/nats-server/releases/tag/v2.15.0
