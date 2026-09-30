# Sync counter

A source root owns a counter.
A guest root receives its snapshot through a local connection.
Both use the same declared cell and keep separate state.
The default demo uses no network or account.

## Run in this repo

From the repo root:

```bash
vp install
vp run -r build
cd examples/sync
vp run start
vp check
vp test
```

`vp run dev` runs the same safe demo.
The output is:

```text
counter:1
```

The source sets its counter to 1 before the guest joins.
Guest readiness waits until that snapshot arrives.
Each run uses fresh roots and a fresh connection.
A closed run leaves the same graph usable for the next run.

## Copy and run on its own

The Tinker libraries are not on npm yet.
From the repo root, export this example with their archives:

```bash
vp run example:export -- sync /tmp/tinker-sync
cd /tmp/tinker-sync
vp install
vp run start
vp check
vp test
```

The copy has its own package, config, and library archives.
It needs Node 22.18 or newer and Vite+.
Its package file selects pnpm 12.4.1.

## Hono stream demo

From this folder:

```bash
vp run hono
```

This demo uses local Hono requests and opens no port.
It opens `GET /sync?client=demo`, then posts a registration:

```json
{ "type": "register", "keys": ["counter"] }
```

The stream sends an SSE frame, a text message prefixed with `data:`.
Its snapshot contains:

```json
{
  "type": "snapshot",
  "key": "counter",
  "version": 0,
  "value": 0
}
```

It starts at 0 because this is a new root.
The demo reads the frame, cancels its reader, and closes the root.
The `src` and `web` exports remain available from `hono.ts`.
An app installs them as `[web, src]`.

## Ownership and checks

`counter.ts` declares the counter and source once.
`basic.ts` declares the connection resource and subscriber once.
The source resource owns the connection's completion promise.
A tag carries the guest's half of that connection.
Both stop signals fire before either root is awaited.
The Sync extensions close the connection.
Each root waits for `closed` in `finally`.
Both close results are checked after both roots finish.
After a successful run, a close or cleanup error makes the command fail.

`hono.ts` keeps live stream callbacks in a root resource.
Each response owns its transport and reader cleanup.
Errors are raised only through `errors.ts`.
Importing `index.ts` starts neither demo.

`vp test` checks the guest snapshot, reuse after close,
and the Hono registration and SSE reply through `index.ts`.
The Sync library tests also use this Hono graph.
