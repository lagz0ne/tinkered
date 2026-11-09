# @tinker/bun

The parts of a Tinker app that run on Bun
(ADR 0130).

- `@tinker/bun`: `serve`, the host on
  `Bun.serve`, and `ws.server`, rpc over
  one WebSocket.
- `@tinker/bun/client`: `ws.client`, the
  browser half of that socket.

## Install

```bash
R=https://github.com/lagz0ne/tinkered/\
releases/download/v0.15.0
bun add $R/tinker-core-0.15.0.tgz \
  $R/tinker-bun-0.15.0.tgz
```

## The host

`serve` runs one server command. It owns the
signals and the exit code.

```ts
import { serve } from "@tinker/bun";
import page from "./index.html";

import main from "./server";

await serve(main, { "/*": page });
```

- A config error at start exits 78.
- Any other throw at start exits 1.
- A failed root exits 1.
- A signal exits 128 plus its number.
- `/api/*`, `/rpc` and `/rpc/*` go to the
  command; `paths` adds more.
- Every other path gets the page.

## The socket

The server, in a command:

```ts
import { ws } from "@tinker/bun";

const app = await createScope({
  capsules: [
    api({ implement }),
    ws.server({ path: "/rpc", services: [api] }),
  ],
}).ready;

const link = app.resolve(ws.server);
```

The command's `fetch`:

```ts
const up = link.upgrade(req, app, bun);
if (up !== undefined) return up;
return (await link.post(req, app)) ?? table(req);
```

`upgrade` gives:

- `undefined`: not this path;
- `null`: upgraded, Bun owns the request;
- a `Response`: refused (a foreign origin
  gives 403).

`post` takes the bytes POSTs of a key with a
bytes field.

The client:

```ts
import { ws } from "@tinker/bun/client";

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
