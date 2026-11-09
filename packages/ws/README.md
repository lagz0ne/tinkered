# @tinker/ws

Tinker rpc and remoteData over one WebSocket (ADR 0130).

- `@tinker/ws`: the client, for a browser or Bun.
- `@tinker/ws/server`: the server, on Bun's own WebSocket.

## Install

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.14.1
bun add $R/tinker-core-0.14.1.tgz \
  $R/tinker-ws-0.14.1.tgz
```

## Use

The server, in a cmd:

```ts
import { ws } from "@tinker/ws/server";

const app = await createScope({
  capsules: [
    api({ implement }),
    ws.server({ path: "/rpc", services: [api] }),
  ],
}).ready;

const link = app.resolve(ws.server);
Bun.serve({
  websocket: link.websocket,
  maxRequestBodySize: link.maxBody,
  fetch: async (req, bun) => {
    const up = link.upgrade(req, app, bun);
    if (up !== undefined) return up;
    return (await link.post(req, app)) ?? table(req);
  },
});
```

`upgrade` gives:

- `undefined`: not this path;
- `null`: upgraded, Bun owns the request;
- a `Response`: refused (a foreign origin gives 403).

`post` takes the bytes POSTs of a key with a bytes field.

The client:

```ts
import { ws } from "@tinker/ws";

const tab = await createScope({
  capsules: [
    ws.client({ url: "wss://host/rpc" }),
    api({ remote: ws.client }),
  ],
}).ready;
```

## Guards

- The Origin check at upgrade.
- A frame over `maxPayload`, or of more than 32
  messages, closes the socket.
- More than `maxWatches` live watches answers 429.
- A socket quiet for 60 s closes.
