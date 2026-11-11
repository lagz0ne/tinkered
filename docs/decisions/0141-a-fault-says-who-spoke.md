# 0141 A fault says who spoke

Date: 2026-11-11. Status: proposed; built on the
field shape in 0.17.5, while Duke picks the shape.
Clear exits (Duke, 07:23): built in 0.17.6.
Changes: the fault of `rpc` and `remoteData`
(ADR 0140 keeps the kinds in Core).
Answers: ADR 0140 open 1, for now.

## What the user said

In the issue board thread, on "does the execution
id also promise a safe retry":

- 07:02: "when we create, the otherside meant to
  be ack (or not), and we'll surely want to
  distinguise between those two. ERror cannot be
  transfered over the wire (unless those are in
  specific format), and there goes local site
  error".
- 07:02: "that'll need to be covered way way
  before retry, because, depending on the error, a
  lot of casse doesn't make sense to be retried at
  all".

So: no call is sent again by itself now. First,
each fault says who spoke.

## Context

The kinds on main (`rpc-wire.ts`):

- `refused`, `invalid`, `failed`: the server's
  answer.
- `encode`, `decode`: either side; the side is in
  `payload.side`.
- `link`: "the transport failed", payload `{}`.

Two gaps, found by the issue board thread and
checked in the code:

1. An unknown address comes back as `link`.
   `serveText` returns `null` ("the transport says
   404"), and `callOver` turns `null` into `link`.
   `streamText` sends `link` too. The server
   answered for certain, and nothing ran. But a
   keyed reader heals a `link` with back-off,
   with no end.
2. `link` does not say if the call left. The bun
   client knows: a socket that never opened sent
   nothing; a drop after `socket.send` is unknown.

## Precedent

- **fetch.** A network error rejects with a
  `TypeError`. An HTTP error is a `Response` with
  a status. Two shapes.
- **Apollo Client.** `networkError` (no answer)
  and `graphQLErrors` (the server's answer) are
  two fields. `RetryLink` retries only the first.
- **tRPC.** A `TRPCClientError` has `shape` and
  `data` only when the server answered.
- **gRPC.** An unknown method is `UNIMPLEMENTED`,
  not `UNAVAILABLE`. A transparent retry happens
  only when the call surely did not reach the
  server's code (gRFC A6).
- **HTTP.** 404 is the server's answer. 502 is the
  path between.

## The proposal

Each fault says who spoke. A local fault also
says if the call left.

```ts
type RemoteFault = Error & {
  fault: Fault; // + "missing"
  from: "server" | "local";
  sent?: boolean; // local only
};
```

The table:

- `refused`, `invalid`, `failed`: server.
- `missing` (new): server. No one serves the
  address, so nothing ran. As 404, and gRPC
  `UNIMPLEMENTED`.
- `encode`, `decode` on the server: server.
- `encode` on the client: local, `sent: false`.
- `invalid` on the client (a part that does not
  fit its key): local, `sent: false`.
- `decode` on the client: local, `sent: true`.
  The server ran it; its answer is lost here.
- `link` before the call left: local,
  `sent: false`.
- `link` after: local, `sent: true`. Unknown.
  A backend that cannot tell says `true`.

What each one does:

- A server fault is an answer. Nothing asks
  again by itself (ADR 0139, decision 4).
- `missing` on a page is an old page against a
  new server (ADR 0140 open 2). The page can
  reload.
- A `link` on a read heals: the backend watches
  again. Any other fault is the same next time,
  so the part waits, as for an answer.
- A local fault on a call is the caller's. Core
  sends nothing again.
- `sent: false` is the one case that is safe to
  send again, for any call. That is for later,
  with the execution id.

```ts
const f = p.fault;
if (f.from === "server") show(f); // same ask, same
else if (!f.sent) offerSend(); // nothing ran
```

## Clear exits at the SPI

Duke, 07:23: "those protocol capsule where it
implements the protocol SPI, they must be tight
safe, with clear exits", because "javascript
throwing is the worst mechanism".

Precedent: a Rust `Result`, Go error values, and
a gRPC status as the only exit. Effect calls a
throw a defect, and gRPC makes it `INTERNAL`.

1. **Every exit is a value.** A backend's `send`
   and `open` resolve, never throw.

   ```ts
   type Exit =
     | { ok: false; kind: "missing" }
     | { ok: false; kind: "link"; sent: boolean };
   // send: { ok: true; text } | Exit
   // open: { ok: true } | Exit
   ```

2. **A throw is a bug.** Core logs the cause with
   the address, in the run's trace, and gives
   `failed` on this side. It is never `link`, so
   nothing asks again.
3. **A closed server ends its watches.** A memory
   server that closes ends each open stream as a
   dropped socket does: `link`, and its close
   settles.
4. **One transport, one server.** Each
   `createMemory()` has its own server ops, so a
   second pair in one scope reaches its own
   server. A shared pair gave `CapsuleMissing`,
   which then showed as offline.

The kit (ADR 0140) gets one case per exit per
backend, one throw inside a backend, two
transports in one scope, and a server that closes
while a client watches.

## Open

- The shape: a field (`from`, as fetch and
  Apollo), or the kind alone with a table in Core
  (as gRPC codes).

## Next

1. `missing`, and `from` and `sent`, in Core and
   in `@tinker/bun`.
2. The table goes in the SPI test kit (ADR 0140):
   every backend maps its failures to it.
