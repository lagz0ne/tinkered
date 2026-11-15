import { capsule, data, operation, tag } from "./index";
import type { Observe, Operation, Scope } from "./index";
import * as z from "./rpc-shape";
import * as transport from "./rpc-transport";

const { callInput, kept, lost, protocol, request, requestStop, traceparentOf, watchInput } =
  transport;

type Call = transport.Call;
type ClientSide = transport.ClientSide;
type Codec = transport.Codec;
type MetaOp = transport.MetaOp;
type Protocol = transport.Protocol;
type RenewOp = transport.RenewOp;
type Reply = transport.Reply;
type ServerSide = transport.ServerSide;
type Service = transport.Service;
type Watch = transport.Watch;

// The memory backend (tests): its own bytes, in one process (ADR 0154). Each value goes through
// the codec to text and back, as on a wire, so a test sees what the codec does. The client runs
// the server scope's text ops in one session per request, as ws.server does: in the client's
// trace, with a request bound (`transport.request`, the fixed headers). A peer holds one server.

/** The text a memory client hands its server: the value as text, and the call's id. */
const textInput = callInput.extend({ value: z.unknown().optional(), text: z.string() });

const streamInput = textInput.extend({
  push: z.custom<(text: string) => void>((v) => typeof v === "function"),
  left: z.custom<AbortSignal>((v) => v instanceof AbortSignal).optional(),
});

type TextServe = Operation.Handle<Promise<string | null>, z.infer<typeof textInput>>;
type TextStream = Operation.Handle<Promise<boolean>, z.infer<typeof streamInput>>;

/** The codec when none is given. */
const json: Codec = {
  serialize: (value) => JSON.stringify(value ?? null),
  deserialize: (text) => JSON.parse(text),
};

type Failed = Extract<Reply, { ok: false }>;
type Coded<T> = { ok: true; value: T } | Failed;

/**
 * The codec, used on one side: a fault keeps its cause in this side's log, and says only the side.
 * `at.log` is read only on a fault, so a call with none makes no logger.
 */
const coding = (codec: Codec, side: "client" | "server", at: { readonly log: Observe.Logger }) => {
  const fault = (kind: "encode" | "decode", address: string, error: unknown): Failed => {
    at.log.error(`protocol ${kind} failed`, {
      address,
      side,
      cause: String(error),
      stack: String(Object(error).stack ?? ""),
    });
    return { ok: false, kind, payload: { side } };
  };
  const step =
    <A, B>(kind: "encode" | "decode", fn: (a: A) => B) =>
    (address: string, a: A): Coded<B> => {
      try {
        return { ok: true, value: fn(a) };
      } catch (error) {
        return fault(kind, address, error);
      }
    };
  const encode = step("encode", (value: unknown) => codec.serialize(value));
  const decode = step("decode", (text: string) => codec.deserialize(text));

  return {
    encode,
    decode,
    /** A reply as text. A reply the codec cannot carry goes out as the encode fault instead. */
    answerText: (address: string, reply: Reply): string => {
      const text = encode(address, reply);
      return text.ok ? text.value : codec.serialize(text);
    },
    replyOf: (address: string, text: string): Reply => {
      const reply = decode(address, text);
      return reply.ok ? (reply.value as Reply) : reply;
    },
  };
};

type ClientConfig = {
  peer: Scope.Handle;
  headers?: Readonly<Record<string, string>>;
  codec?: Codec;
  meta?: MetaOp;
  renew?: RenewOp;
};

/** The exits of a memory send or open (ADR 0141): a closed peer ran nothing. */
const closed = lost({ ok: false, kind: "link", sent: false });
const missing = lost({ ok: false, kind: "missing" });
const gone = lost({ ok: false, kind: "link", sent: true });

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
 * its peer, whichever backend made it, as a socket reaches the server at its URL.
 */
const served = data<{ serve: TextServe; serveStream: TextStream } | null>({
  label: "memory.served",
  initial: null,
});

type StreamIn = z.infer<typeof streamInput>;

/** What a started server holds: the route table, its codec, and the protocol's steps. */
type Held = { readonly side: ServerSide; readonly codec: Codec; readonly protocol: Protocol };

/**
 * One text op of the server: decode, then the protocol's `answer` or `stream`, then encode. A
 * codec that throws rejects the run (async), as a throw in the protocol did.
 */
const serveText = (
  { side, codec, protocol: p }: Held,
  hook: transport.Hook,
  answering: boolean,
  { text, ...input }: StreamIn,
): Promise<string | null | boolean> => {
  const { decode, answerText } = coding(codec, "server", hook);
  const answerOf = async (reply: Reply | null) => reply && answerText(input.address, reply);
  const push = (reply: Reply) => input.push(answerText(input.address, reply));
  const read = decode(input.address, text);
  // A text the codec cannot read: the decode fault, as the answer or the one push.
  if (!read.ok) {
    return answering ? answerOf(read) : Promise.resolve().then(() => (push(read), true));
  }

  const asked = { ...input, value: read.value };
  if (answering) return p.answer(side, hook, asked).then(answerOf);
  return p.stream(side, hook, { ...asked, push });
};

/** Makes one memory backend. A scope can hold two clients (a public one and a signed one). */
export function createMemory() {
  // The server's text ops: one pair per backend. One pair shared by two backends made the
  // second's server unknown to Core (CapsuleMissing); the peer's `served` names the right one.
  const serve = operation({
    label: "memory.serve",
    input: textInput,
    run: (): Promise<string | null> => {
      throw new Error("memory: no server here");
    },
  }) as TextServe;

  const serveStream = operation({
    label: "memory.serveStream",
    input: streamInput,
    run: (): Promise<boolean> => {
      throw new Error("memory: no server here");
    },
  }) as TextStream;

  const peer = tag<Scope.Handle>({ label: "memory.peer" });
  const headers = tag<Readonly<Record<string, string>>>({ label: "memory.headers", default: {} });
  const codecKey = tag<Codec>({ label: "memory.codec", default: json });
  const keys = {
    meta: tag<MetaOp>({ label: "memory.meta" }).optional,
    renew: tag<RenewOp>({ label: "memory.renew" }).optional,
  };
  const clientDeps = { peer: peer.required, headers, codec: codecKey, protocol };

  /** A value out as text: the session on the peer and its server's ops, or the fault. */
  const reach = (
    {
      peer,
      headers,
      codec,
      protocol,
    }: {
      peer: Scope.Handle;
      headers: Readonly<Record<string, string>>;
      codec: Codec;
      protocol: Protocol;
    },
    input: z.infer<typeof callInput>,
    span: Observe.Span | undefined,
    at: { readonly log: Observe.Logger },
  ) => {
    const code = coding(codec, "client", at);
    const text = code.encode(input.address, input.value);
    if (!text.ok) return { fault: text }; // nothing is sent

    const session = sessionOf(peer, headers, input, protocol.traceparent(span));
    // A closed peer, or one with no memory server: nothing ran.
    const ops = session?.resolve(served);
    if (!session || !ops) return { fault: closed, session };

    const { value: _, ...rest } = input;
    return { session, ops, code, sent: { ...rest, text: text.value } };
  };

  const send = operation({
    label: "memory.send",
    input: callInput,
    depends: clientDeps,
    run: async (deps, ctx): Promise<Reply> => {
      const { input } = ctx;
      const got = reach(deps, input, ctx.obs.span, ctx);
      if (!got.ops) return (await got.session?.close(), got.fault);

      const { session, ops, code, sent } = got;
      // A throw in the run is a bug, not a link: the protocol logs it (ADR 0141).
      const reply: string | null | undefined = await session
        .run(ops.serve, { input: sent })
        .finally(() => session.close());

      if (reply === undefined) return gone;
      return reply === null ? missing : code.replyOf(input.address, reply);
    },
  });

  const open = operation({
    label: "memory.open",
    input: watchInput,
    depends: clientDeps,
    run: async (deps, ctx): Promise<{ ok: true } | Failed> => {
      const { input, signal } = ctx;
      const got = reach(deps, input, ctx.obs.span, ctx);
      if (!got.ops) return (await got.session?.close(), got.fault);

      const { session, ops, code, sent } = got;
      const push = (text: string) => input.push(code.replyOf(input.address, text));
      return session
        .run(ops.serveStream, { input: { ...sent, push, left: signal } })
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
    config: { peer: peer.required, headers, codec: codecKey, ...keys },
    exports: { call, watch },
    hooks: {
      async start({ config, load, next }) {
        const p = await load(protocol, kept);
        const { meta, renew } = config;
        load(clientHeld, kept).set({
          protocol: p,
          side: { send, open, meta: p.given(meta), renew: p.given(renew) },
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

  const serverHeld = data<Held | null>({
    label: "transport.server",
    initial: null,
  });

  const server = capsule({
    label: "memory.server",
    config: {
      codec: tag<Codec>({ label: "memory.server.codec", default: json }),
      services: tag<readonly Service[]>({ label: "memory.services" }).required,
      strict: tag<boolean>({ label: "memory.strict", default: true }),
    },
    exports: { serve, serveStream },
    hooks: {
      async start({ config, load, next, raise, log }) {
        const p = await load(protocol, kept);
        const routes = p.routesOf(config.services, raise as never, log, config.strict);
        load(serverHeld, kept).set({ side: { routes }, codec: config.codec, protocol: p });
        load(served, kept).set({ serve, serveStream });

        return next();
      },
      run(event): unknown {
        const { op, call: invocation } = event;
        if (op !== serve && op !== serveStream) return event.next();

        const { run, load, closing: stop } = event;
        const hook = { run, log: event.log, signal: invocation?.signal };
        const input = Object(invocation?.input ?? invocation?.rawInput) as StreamIn;
        const answering = op === serve;
        const asked = answering ? input : cut(input, stop);
        return dropped(stop, serveText(load(serverHeld, kept).get()!, hook, answering, asked));
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

/** The default memory backend. */
export const memory = createMemory();
