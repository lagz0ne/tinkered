# rpc

`rpc` is one contract for both sides. The server
installs it with `implement`. The client installs
it with `remote`. An op calls it the same way on
either side.

## The contract

```ts
export const seaApi = rpc({
  "wave.press": {
    input: z.object({
      room: z.string(),
      x: z.number(),
      y: z.number(),
    }),
    output: z.object({ hue: z.number() }),
  },
});
```

## The server

```ts
capsules: [
  sea.api({ implement: { "wave.press": press } }),
  ws.server({ path: "/rpc", services: [sea.api] }),
],
```

## The client

```ts
capsules: [
  ws.client({ url }),
  sea.api({ remote: ws.client }),
],
// page
const press = useRun(sea.api["wave.press"]);
```

## Faults

A failed call is a fault from a fixed set:

- `refused`: a guard said no.
- `failed`: the server threw. The cause stays
  in the server log; the client gets a trace id.
- `invalid`, `encode`, `decode`: a bad shape.
- `link`: the wire is down.

`sea.api.fault.is(error)` tells a fault.

## The backend

Core owns the meaning: the shape, the faults and
what `call` and `watch` promise. A backend owns the
wire: `ws` from `@tinker/bun`, `memory` for tests.
