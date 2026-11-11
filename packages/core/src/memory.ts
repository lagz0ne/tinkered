import { capsule, data, operation, tag } from "./index";
import type { Scope } from "./index";
import * as transport from "./rpc-transport";

const {
  callInput,
  kept,
  openInput,
  protocol,
  request,
  requestStop,
  sendInput,
  traceparentOf,
  watchInput,
} = transport;

type Call = transport.Call;
type ClientSide = transport.ClientSide;
type Codec = transport.Codec;
type MetaOp = transport.MetaOp;
type Protocol = transport.Protocol;
type RenewOp = transport.RenewOp;
type Reply = transport.Reply;
type ServerSide = transport.ServerSide;
type Service = transport.Service;
type TextServe = transport.TextServe;
type TextStream = transport.TextStream;
type Watch = transport.Watch;

// The memory transport (tests): the same protocol, in one process. The client runs the server
// scope's text ops in one session per request, as ws.server does: in the client's trace, with
// a request bound (`transport.request`, the fixed headers). A peer holds one memory server.

type ClientConfig = {
  peer: Scope.Handle;
  headers?: Readonly<Record<string, string>>;
  codec?: Codec;
  meta?: MetaOp;
  renew?: RenewOp;
};

/** The exits of a memory send or open (ADR 0141): a closed peer ran nothing. */
const closed = { ok: false, kind: "link", sent: false } as const;
const missing = { ok: false, kind: "missing" } as const;
const gone = { ok: false, kind: "link", sent: true } as const;

/** A request session on the peer, as a socket's request; null when the peer is closed. */
const sessionOf = (
  peer: Scope.Handle,
  headers: Readonly<Record<string, string>>,
  input: { address: string; meta: Record<string, string> },
  own: Record<string, string>,
) => {
  const req = new Request(`http://memory/${input.address}`, { headers });
  try {
    return peer.createSession({
      trace: traceparentOf({ ...input.meta, ...own }.traceparent),
      tags: [request(req), requestStop(req.signal)],
    });
  } catch {
    return null;
  }
};

/**
 * A close of the server ends its streams, as a socket that drops (ADR 0141): `left` aborts, so the
 * close settles, and later pushes go nowhere.
 */
const cut = <I extends { left?: AbortSignal; push: (text: string) => void }>(
  input: I,
  stop: AbortSignal,
): I => ({
  ...input,
  left: AbortSignal.any([input.left ?? stop, stop]),
  push: (text: string) => stop.aborted || input.push(text),
});

/** A reply of a server that closed is dropped: `undefined`, which the client reads as a link. */
const dropped = (stop: AbortSignal, reply: Promise<unknown>) =>
  reply.then((value) => (stop.aborted ? undefined : value));

/**
 * The server ops a peer holds, set by its memory server at start. A client reaches the server in
 * its peer, whichever transport made it, as a socket reaches the server at its URL.
 */
const served = data<{ serve: TextServe; serveStream: TextStream } | null>({
  label: "memory.served",
  initial: null,
});

/** Makes one memory transport. A scope can hold two clients (a public one and a signed one). */
export function createMemory() {
  // The server's text ops: one pair per transport. One pair shared by two transports made the
  // second's server unknown to Core (CapsuleMissing); the peer's `served` names the right one.
  const serve = operation({
    label: "memory.serve",
    input: sendInput,
    run: (): Promise<string | null> => {
      throw new Error("memory: no server here");
    },
  }) as TextServe;

  const serveStream = operation({
    label: "memory.serveStream",
    input: openInput,
    run: (): Promise<boolean> => {
      throw new Error("memory: no server here");
    },
  }) as TextStream;

  const peer = tag<Scope.Handle>({ label: "memory.peer" });
  const headers = tag<Readonly<Record<string, string>>>({ label: "memory.headers", default: {} });
  const keys = {
    codec: tag<Codec>({ label: "memory.codec" }).optional,
    meta: tag<MetaOp>({ label: "memory.meta" }).optional,
    renew: tag<RenewOp>({ label: "memory.renew" }).optional,
  };

  const send = operation({
    label: "memory.send",
    input: sendInput,
    depends: { peer: peer.required, headers, protocol },
    run: async ({ peer, headers, protocol }, { input, obs }) => {
      const session = sessionOf(peer, headers, input, protocol.traceparent(obs.span));
      // A closed peer, or one with no memory server: nothing ran.
      if (!session) return closed;

      const ops = session.resolve(served);
      if (!ops) return (await session.close(), closed);
      // A throw in the run is a bug, not a link: the protocol logs it (ADR 0141).
      const reply: string | null | undefined = await session
        .run(ops.serve, { input })
        .finally(() => session.close());
      if (reply === undefined) return gone;
      return reply === null ? missing : { ok: true as const, text: reply };
    },
  });

  const open = operation({
    label: "memory.open",
    input: openInput,
    depends: { peer: peer.required, headers, protocol },
    run: async ({ peer, headers, protocol }, { input, signal, obs }) => {
      const session = sessionOf(peer, headers, input, protocol.traceparent(obs.span));
      if (!session) return closed;

      const ops = session.resolve(served);
      if (!ops) return (await session.close(), closed);
      return session
        .run(ops.serveStream, { input: { ...input, left: signal } })
        .then((found: boolean | undefined) =>
          found === undefined ? gone : found ? { ok: true as const } : missing,
        )
        .finally(() => session.close());
    },
  });

  /** What rpc and remoteData run: a value out, the reply (or the pushes) back. */
  const call = operation({
    label: "memory.call",
    input: callInput,
    run: (): Promise<Reply> => {
      throw new Error("memory: no transport here");
    },
  }) as Call;

  const watch = operation({
    label: "memory.watch",
    input: watchInput,
    run: (): Promise<void> => {
      throw new Error("memory: no transport here");
    },
  }) as Watch;

  const clientHeld = data<{ side: ClientSide; protocol: Protocol } | null>({
    label: "transport.client",
    initial: null,
  });

  const client = capsule({
    label: "memory",
    config: { peer: peer.required, headers, ...keys },
    exports: { call, watch },
    hooks: {
      async start({ config, load, next }) {
        const p = await load(protocol, kept);
        const { codec, meta, renew } = config;
        load(clientHeld, kept).set({
          protocol: p,
          side: {
            send,
            open,
            codec: p.given(codec) ?? p.json,
            meta: p.given(meta),
            renew: p.given(renew),
          },
        });
        return next();
      },
      run(event): unknown {
        const { op, call: invocation } = event;
        if (op !== call && op !== watch) return event.next();

        const { run, log, load } = event;
        const { side, protocol: p } = load(clientHeld, kept).get()!;
        const hook = { run, log, signal: invocation?.signal };
        const input = (invocation?.input ?? invocation?.rawInput) as never;
        return op === call ? p.callOver(side, hook, input) : p.watchOver(side, hook, input);
      },
    },
  });

  const serverHeld = data<{ side: ServerSide; protocol: Protocol } | null>({
    label: "transport.server",
    initial: null,
  });

  const server = capsule({
    label: "memory.server",
    config: {
      codec: tag<Codec>({ label: "memory.codec" }).optional,
      services: tag<readonly Service[]>({ label: "memory.services" }).required,
      strict: tag<boolean>({ label: "memory.strict", default: false }),
    },
    exports: { serve, serveStream },
    hooks: {
      async start({ config, load, next, raise, log }) {
        const p = await load(protocol, kept);
        const routesOf = p.routesOf(config.services, raise as never, log, config.strict);
        const side = { codec: p.given(config.codec) ?? p.json, routes: routesOf };
        load(serverHeld, kept).set({ side, protocol: p });
        load(served, kept).set({ serve, serveStream });

        return next();
      },
      run(event): unknown {
        const { op, call: invocation } = event;
        if (op !== serve && op !== serveStream) return event.next();

        const { run, log, load, closing: stop } = event;
        const { side, protocol: p } = load(serverHeld, kept).get()!;
        const hook = { run, log, signal: invocation?.signal };

        const input = Object(invocation?.input ?? invocation?.rawInput);
        return dropped(
          stop,
          op === serve
            ? p.serveText(side, hook, input)
            : p.streamText(side, hook, cut(input, stop)),
        );
      },
    },
  });

  return {
    client: client as unknown as Omit<typeof client, never> & {
      readonly call: Call;
      readonly watch: Watch;
      (values: ClientConfig): ReturnType<typeof client>;
    },
    server: server as unknown as Omit<typeof server, never> & {
      readonly serve: TextServe;
      readonly serveStream: TextStream;
      (values: {
        codec?: Codec;
        services: readonly Service[];
        strict?: boolean;
      }): ReturnType<typeof server>;
    },
  };
}

/** The default memory transport. */
export const memory = createMemory();
