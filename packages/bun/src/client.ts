import { capsule, data, operation, tag, transport } from "@tinkered/core";

import { coding, json, withId } from "./codec";
import { Tools } from "./tools";

const { callInput, kept, lost, protocol, watchInput } = transport;

type Call = transport.Call;
type ClientSide = transport.ClientSide;
type Codec = transport.Codec;
type Exit = transport.Exit;
type MetaOp = transport.MetaOp;
type Protocol = transport.Protocol;
type RenewOp = transport.RenewOp;
type Reply = transport.Reply;
type Watch = transport.Watch;

// The WebSocket transport, client side: every call and watch of a client on ONE socket.
// As tRPC wsLink: messages carry an id; as httpBatchLink: the messages of one tick go as one
// frame (a JSON array, at most 32). Both ways: the server also sends one frame per tick, so the
// keys one write changed arrive together (F35) with no shared stream in the protocol.
//
//   call   {i, a: address, t: text, m: meta}     answer {i, t} | {i, e: status}
//          (`m.execution` is the call's id: its own SPI field, carried here as before)
//   watch  {i, a, t, m, w: 1}                    pushes {i, t} ... then {i, end: 1}
//   stop   {i, x: 1}
//
// The socket opens on the first message (wsLink lazy) and closes with the scope. When it drops,
// every call and watch on it fails as a link fault; remoteData's back-off opens a new one.

type ClientConfig = {
  url: string;
  /** Headers on the upgrade (Bun only: a browser sends its own cookies; a test sets them). */
  headers?: Readonly<Record<string, string>>;
  codec?: Codec;
  meta?: MetaOp;
  renew?: RenewOp;
};

/** One message of a frame, client to server. */
type Out = { i: number; a?: string; t?: string; m?: Record<string, string>; w?: 1; x?: 1 };
/** One message of a frame, server to client. */
type In = { i: number; t?: string; e?: number; end?: 1 };
/** Gets each message for its id; null when the socket dropped, with whether the id had left. */
type Waiter = (message: In | null, sent?: boolean) => void;

/**
 * How a send or open ends when no text came (ADR 0141): a value, never a throw. A 404 is the
 * server's `missing`; a drop before the message left is `sent: false`, nothing ran.
 */
const exitOf = (message: In | null, sent = true): Exit =>
  message?.e === 404 ? { ok: false, kind: "missing" } : { ok: false, kind: "link", sent };

/** The most messages in one frame: the server closes a socket that sends more (tRPC maxBatchSize). */
export const frameMax = 32;

/** The next task in a browser: one `MessageChannel` and a queue, as React's scheduler does. */
function viaChannel(): (fn: () => void) => void {
  const jobs: (() => void)[] = [];
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => jobs.shift()!();
  return (fn) => (jobs.push(fn), port2.postMessage(0));
}

/**
 * Runs `fn` in the next task, with no timer wait. `setTimeout(0)` waits at least 1 ms on Bun and
 * Node, and 4 ms in a browser once timers nest (HTML timer clamp). Bun and Node have
 * `setImmediate`, which does not keep the process alive as an open port does. It reads
 * `setImmediate` at each call, not once at load, so a test that wraps it later still sees the tick.
 */
const nextTick =
  typeof setImmediate === "function" ? (fn: () => void) => setImmediate(fn) : viaChannel();

/** Makes one WebSocket client. */
export function createWs() {
  const url = tag<string>({ label: "ws.url" });
  const headers = tag<Readonly<Record<string, string>>>({ label: "ws.headers", default: {} });
  const keys = {
    codec: tag<Codec>({ label: "ws.codec", default: json }),
    meta: tag<MetaOp>({ label: "ws.meta" }).optional,
    renew: tag<RenewOp>({ label: "ws.renew" }).optional,
  };

  /** The open sockets (one at most), the waiters by id, the next id, `post`. One per scope. */
  type Link = {
    sockets: Set<WebSocket>;
    waits: Map<number, Waiter>;
    next: number;
    post: (message: Out) => void;
    /** Fails every waiter of this socket, drops its unsent frames, and forgets it; another socket's close is no-op. */
    drop: (socket: WebSocket | null) => void;
    /** Drops the socket: every waiter fails as a link fault, and the next message opens a new one. */
    reset: () => void;
  };
  const link = data<Link | null>({ label: "ws.link", initial: null });

  // The bytes are this backend's (ADR 0154): the protocol hands a value, these send its text and
  // read the reply. The span goes as `traceparent` in `m`.
  // A call or a watch with no signal of its own gets the scope's signal, which lives as long as
  // the tab: each takes its abort listener off when it ends, so none stays on that signal. So
  // `stop` runs only while its call or watch waits.
  type Got = { ok: true; text: string } | Exit;
  type Asked = { address: string; text: string; m: Record<string, string>; signal: AbortSignal };

  /**
   * Bytes go on their own POST beside the socket: `<url>/<address>`, the value as text in
   * `x-input`, the meta in `x-meta`, the bytes as the body, streamed by fetch.
   * A fetch that rejects is the network (MDN: a TypeError), so a link that may have sent.
   */
  const postBytes = async (
    to: { url: string; headers: Readonly<Record<string, string>> },
    { address, text, m, signal }: Asked,
    body: Blob,
  ): Promise<Got> => {
    const answer = await fetch(`${to.url.replace(/^ws/, "http")}/${address}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        ...to.headers,
        "content-type": body.type,
        "x-input": text,
        "x-meta": JSON.stringify(m),
      },
      body,
      signal,
    }).catch(() => null);
    if (!answer) return exitOf(null);
    if (!answer.ok) {
      void answer.body?.cancel();
      return exitOf({ i: 0, e: answer.status });
    }

    return answer.text().then(
      (got) => ({ ok: true as const, text: got }),
      () => exitOf(null),
    );
  };

  /** One call on the socket: its answer's text, or the exit. */
  const onSocket = (own: Link, { address, text, m, signal }: Asked) =>
    new Promise<Got>((got) => {
      const i = own.next++;
      const stop = () => {
        own.waits.delete(i);
        own.post({ i, x: 1 });
        got(exitOf(null));
      };
      own.waits.set(i, (message, sent) => {
        own.waits.delete(i);
        signal.removeEventListener("abort", stop);
        got(message?.t === undefined ? exitOf(message, sent) : { ok: true, text: message.t });
      });
      signal.addEventListener("abort", stop);
      own.post({ i, a: address, t: text, m });
    });

  const send = operation({
    label: "ws.send",
    input: callInput,
    depends: { link: link.controller, protocol, url: url.required, headers, codec: keys.codec },
    run: async ({ link, protocol, url, headers, codec }, ctx): Promise<Reply> => {
      const { input, signal } = ctx;
      const { encode, replyOf } = coding(codec, "client", ctx);
      const text = encode(input.address, input.value);
      if (!text.ok) return text; // nothing is sent

      const m = withId({ ...input.meta, ...protocol.traceparent(ctx.obs.span) }, input.execution);
      const asked = { address: input.address, text: text.value, m, signal };

      const got = await (input.body
        ? postBytes({ url, headers }, asked, input.body as Blob)
        : onSocket(link.get()!, asked));
      return got.ok ? replyOf(input.address, got.text) : lost(got);
    },
  });

  /** One watch on the socket: each push's text to `push`, until it ends (`ok`) or its exit. */
  const watchOnSocket = (
    own: Link,
    { address, text, m, signal }: Asked,
    push: (text: string) => void,
  ) =>
    new Promise<{ ok: true } | Exit>((ended) => {
      const i = own.next++;
      // A reader that leaves stops the server's stream: the server ends the watch.
      const stop = () => {
        own.waits.delete(i);
        own.post({ i, x: 1 });
        ended({ ok: true });
      };
      own.waits.set(i, (message, sent) => {
        if (message?.t !== undefined) return push(message.t);
        own.waits.delete(i);
        signal.removeEventListener("abort", stop);
        ended(message?.end ? { ok: true } : exitOf(message, sent));
      });
      signal.addEventListener("abort", stop);
      own.post({ i, a: address, t: text, m, w: 1 });
    });

  const open = operation({
    label: "ws.open",
    input: watchInput,
    depends: { link: link.controller, protocol, codec: keys.codec },
    run: async ({ link, protocol, codec }, ctx) => {
      const { input, signal } = ctx;
      const { encode, replyOf } = coding(codec, "client", ctx);
      const text = encode(input.address, input.value);
      if (!text.ok) return text; // nothing is sent

      const m = { ...input.meta, ...protocol.traceparent(ctx.obs.span) };
      const push = (t: string) => input.push(replyOf(input.address, t));

      const end = await watchOnSocket(link.get()!, { ...input, text: text.value, m, signal }, push);
      return end.ok ? end : lost(end);
    },
  });

  /**
   * Drops the socket, so the next call opens a new one. The server reads the cookie once, at the
   * upgrade: an app runs this when the account changes (a sign-in, a sign-out), as Phoenix and
   * Socket.IO reconnect on a new session. Calls and watches on the old socket fail as `link`;
   * remoteData's back-off opens their watches again, on the new socket.
   */
  const reset = operation({
    label: "ws.reset",
    depends: { link: link.controller },
    run: ({ link }) => link.get()?.reset(),
  });

  /** What rpc and remoteData run: a value out, the reply (or the pushes) back. */
  const call = operation({
    label: "ws.call",
    input: callInput,
    run: (): Promise<Reply> => {
      throw new Error("ws: no transport here");
    },
  }) as Call;

  const watch = operation({
    label: "ws.watch",
    input: watchInput,
    run: (): Promise<void> => {
      throw new Error("ws: no transport here");
    },
  }) as Watch;

  const held = data<{ side: ClientSide; protocol: Protocol } | null>({
    label: "transport.client",
    initial: null,
  });

  /** The client: `call` and `watch`, for rpc and remoteData. */
  const client = capsule({
    label: "ws",
    config: { url: url.required, headers, ...keys },
    exports: { call, watch, reset },
    hooks: {
      async start({ config, load, next }) {
        const p = await load(protocol, kept);

        const out: Out[] = [];
        const waits = new Map<number, Waiter>();
        const sockets = new Set<WebSocket>();
        /** The ids whose message left on the socket now in use, until their end. */
        const gone = new Set<number>();
        let opening: Promise<WebSocket> | null = null;
        /** The socket now in use: a close of an older one fails nothing of the new one's. */
        let current: WebSocket | null = null;

        /**
         * Fails every waiter, drops the frames not yet sent (their waiters fail here too), and
         * forgets the socket: the next message opens a new one. A tick already scheduled still runs;
         * it sends only the frames posted after this drop.
         */
        const drop = (socket: WebSocket | null) => {
          if (socket !== current) return;

          current = null;
          opening = null;
          if (socket) sockets.delete(socket);
          out.splice(0);
          for (const [i, waiter] of waits) waiter(null, gone.has(i));
          waits.clear();
          gone.clear();
        };

        // The first message of a tick schedules the frame; the frame opens the socket if needed.
        const post = (message: Out) => {
          if (out.push(message) > 1) return;
          nextTick(() => {
            const sent = out.splice(0);
            opening ??= new Promise<WebSocket>((done, broke) => {
              const socket = Object.keys(config.headers).length
                ? new WebSocket(config.url, { headers: config.headers } as never)
                : new WebSocket(config.url);
              current = socket;
              socket.addEventListener("open", () => done((sockets.add(socket), socket)));
              socket.addEventListener("message", (event) => {
                for (const m of JSON.parse(String(event.data)) as In[]) {
                  waits.get(m.i)?.(m);
                  if (!waits.has(m.i)) gone.delete(m.i);
                }
              });
              socket.addEventListener("close", () => {
                drop(socket);
                broke(new Error("TransportFailed"));
              });
            });
            void opening.then(
              (socket) => {
                for (let at = 0; at < sent.length; at += frameMax) {
                  socket.send(JSON.stringify(sent.slice(at, at + frameMax)));
                }
                for (const m of sent) gone[m.x ? "delete" : "add"](m.i);
              },
              () => undefined, // the close already failed every waiter
            );
          });
        };

        /** Drops the socket now in use, and closes it. */
        const reset = () => {
          const old = current;

          drop(old);
          old?.close(1000, "reset");
        };

        load(link, kept).set({ sockets, waits, next: 1, post, drop, reset });
        load(held, kept).set({
          protocol: p,
          side: { send, open, meta: p.given(config.meta), renew: p.given(config.renew) },
        });

        return next();
      },
      /** Every run of the scope passes here: one that is not this transport's reads `op` only. */
      run(event): unknown {
        const { op, call: invocation } = event;
        if (op !== call && op !== watch) return event.next();

        const { side, protocol: p } = event.load(held, kept).get()!;
        const hook = op === call ? new Tools(event) : new Tools(event, event.signal);
        const input = (invocation?.input ?? invocation?.rawInput) as never;
        return op === call ? p.callOver(side, hook, input) : p.watchOver(side, hook, input);
      },
      async close({ load, next }) {
        for (const socket of load(link, kept).get()?.sockets ?? []) socket.close(1000);
        return next();
      },
    },
  });

  return {
    client: client as unknown as Omit<typeof client, never> & {
      readonly call: Call;
      readonly watch: Watch;
      readonly reset: typeof reset;
      (values: ClientConfig): ReturnType<typeof client>;
    },
  };
}

/** The default WebSocket client. */
export const ws = createWs();
