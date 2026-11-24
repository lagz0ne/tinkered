import { capsule, data, operation, tag, transport } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";

import { frameMax } from "./client";
import { given, idOff, json, serveText } from "./codec";
import type { Held, StreamIn, TextIn, TextServe, TextStream } from "./codec";
import { Tools } from "./tools";

const { kept, protocol, request, requestStop, traceparentOf } = transport;

type BytesLimit = transport.BytesLimit;
type Codec = transport.Codec;
type Service = transport.Service;

/** True for an object of string values only: the `x-meta` header of a bytes POST. */
const isTextRecord = (v: unknown): v is Record<string, string> =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v).every((each) => typeof each === "string");

/**
 * An answer before the body is read closes the connection (RFC 9110 15.5.14): the client may
 * still be sending the body, and Bun's graceful `stop` would wait on it.
 */
const refused = { connection: "close" };

/** The 503 for `maxUploads`: it closes too, and says when to try again. */
const refusedBusy = { connection: "close", "retry-after": "1" };

// The WebSocket transport, server side: one socket per client, on Bun's own WebSocket.
// Frames are JSON arrays of messages (see the client). Each call and each watch runs in its own
// session of the scope, as an HTTP request does, with the upgrade request bound. The answers and
// pushes of one tick go out as one frame per socket, so one write's keys arrive together (F35).
//
// Guards (OWASP WebSocket cheat sheet, Bun limits, tRPC maxBatchSize):
// - the Origin check at upgrade: a browser sends cookies on a cross-site upgrade (CSWSH);
// - a frame over `maxPayload`, or not an array of at most 32 messages, closes the socket;
// - a slow reader past `maxPayload` of unsent bytes is closed, not buffered without end;
// - more than `maxWatches` live watches answers that watch with 429;
// - a socket quiet for 60 s is closed (Bun pings it first).
//
// Bytes come on their own POST, `<path>/<address>`, for a key with a bytes field only. Before it
// reads one byte (Fastify's bodyLimit, under-pressure, OWASP file upload cheat sheet):
// - 404 for a key with no bytes field: nothing else takes a POST;
// - 403 for a foreign Origin; 400 with no `x-input`, a header a cross-site form cannot set
//   without a CORS preflight, and this server answers no preflight;
// - 431 for `x-input` or `x-meta` over 2 KiB; 415 for a type the key does not list;
// - 413 when Content-Length says more than the key's max;
// - 503 with Retry-After when `maxUploads` POSTs run already.
// Then the implementation gets the body lazily: the stream is read only when it reads, counted
// (413 once past the max, whatever Content-Length said), and cut at `uploadDeadline`. The onStart
// hooks run first, so a refused call never reads the body; an unread body is cancelled.

type ServerConfig = {
  path: string;
  services: readonly Service[];
  codec?: Codec;
  origin?: string | null;
  maxPayload?: number;
  maxWatches?: number;
  maxUploads?: number;
  uploadDeadline?: number;
  strict?: boolean;
};

type Msg = { i: number; a?: string; t?: string; m?: Record<string, string>; w?: 1; x?: 1 };

/** What each socket holds: its upgrade request, scope, live watches, this tick's frame, steps. */
type Socket = {
  req: Request;
  scope: Scope.Handle;
  gone: AbortController;
  watches: Map<number, AbortController>;
  out: unknown[];
  emit: (ws: ServerWebSocket<Socket>, message: unknown) => void;
  pusher: (ws: ServerWebSocket<Socket>, i: number) => (text: string) => void;
  one: (ws: ServerWebSocket<Socket>, m: Msg) => Promise<unknown>;
  run: (ws: ServerWebSocket<Socket>, m: Msg) => Promise<unknown>;
  watch: (
    ws: ServerWebSocket<Socket>,
    m: Msg,
    left: AbortSignal,
    serve: () => Promise<boolean | undefined>,
  ) => Promise<unknown>;
};

/** Makes one WebSocket server. */
export function createWs() {
  const path = tag<string>({ label: "ws.path" });
  const codec = tag<Codec>({ label: "ws.codec", default: json });
  const services = tag<readonly Service[]>({ label: "ws.services" }).required;
  const strict = tag<boolean>({ label: "ws.strict", default: true });
  /** The public origin a socket comes from. Unset, it is the request URL's own origin; behind a
   * TLS proxy that is `http://<host>`, so the app binds its public `https` origin here. */
  const origin = tag<string | null>({ label: "ws.origin", default: null });
  /** The largest frame in, and the most unsent bytes out, per socket (1 MiB). */
  const maxPayload = tag<number>({
    label: "ws.maxPayload",
    default: 1_048_576,
    parse: (raw) => {
      if (!Number.isSafeInteger(raw) || Number(raw) <= 0) {
        throw new TypeError("not a positive whole number of bytes");
      }
      return Number(raw);
    },
  });
  const maxWatches = tag<number>({ label: "ws.maxWatches", default: 256 });
  /** The most bytes POSTs at once, on this server. */
  const maxUploads = tag<number>({ label: "ws.maxUploads", default: 8 });
  /** The most time a bytes POST may take, in ms (5 min). */
  const uploadDeadline = tag<number>({ label: "ws.uploadDeadline", default: 300_000 });

  const serve = operation({
    label: "ws.serve",
    input: given<TextIn>(),
    run: (): Promise<string | null> => {
      throw new Error("ws: no server here");
    },
  }) as TextServe;

  const serveStream = operation({
    label: "ws.serveStream",
    input: given<StreamIn>(),
    run: (): Promise<boolean> => {
      throw new Error("ws: no server here");
    },
  }) as TextStream;

  /**
   * A bytes POST's body: the request's stream, read once and only when the implementation reads
   * it, counted (`over` once past `max`, whatever Content-Length said) and cut at `stop`.
   */
  const bodyOf = operation({
    label: "ws.body",
    input: given<{ req: Request; max: number; type: string; stop: AbortSignal }>(),
    run: (_, { input: { req, max, type, stop } }) => ({
      type,
      read: false,
      seen: 0,
      over: false,
      stream(): ReadableStream<Uint8Array> {
        if (this.read) throw new TypeError("The body was read already.");
        this.read = true;
        const counted = new TransformStream<Uint8Array, Uint8Array>({
          transform: (chunk, out) => {
            this.seen += chunk.byteLength;
            if (this.seen <= max) return out.enqueue(chunk);
            this.over = true;
            out.error(new RangeError("The body is over its max."));
          },
        });
        return (req.body ?? new Blob().stream()).pipeThrough(counted, { signal: stop });
      },
      bytes() {
        return new Response(this.stream()).bytes();
      },
      text() {
        return new Response(this.stream()).text();
      },
      arrayBuffer() {
        return new Response(this.stream()).arrayBuffer();
      },
    }),
  });

  /**
   * The guards of a bytes POST, before a byte is read: the first that fails answers, in the order
   * of the comment at the top. Else the call's text, meta and type, read off the headers.
   */
  const admit = operation({
    label: "ws.admit",
    input: given<{ req: Request; limit?: BytesLimit; origin: string; busy: boolean }>(),
    run: async (_, { input: { req, limit = { max: 0, types: [] }, origin, busy } }) => {
      const h = Object.fromEntries(req.headers) as Record<string, string | undefined>;
      const type = String(h["content-type"]).split(";")[0]!.trim().toLowerCase();
      const meta = await Promise.resolve(h["x-meta"] ?? "{}")
        .then(JSON.parse)
        .catch(() => null);
      const guards: [boolean, number][] = [
        [limit.max > 0, 404],
        [[undefined, origin].includes(h.origin), 403],
        [h["x-input"] !== undefined, 400],
        [String(h["x-input"]).length <= 2048 && String(h["x-meta"]).length <= 2048, 431],
        [isTextRecord(meta), 400],
        [limit.types.includes(type), 415],
        [!(Number(h["content-length"]) > limit.max), 413],
        [!busy, 503],
      ];
      const status = guards.find(([ok]) => !ok)?.[1];
      if (!status) {
        return { text: String(h["x-input"]), meta: meta as Record<string, string>, type };
      }

      return new Response(null, { status, headers: status === 503 ? refusedBusy : refused });
    },
  });

  const held = data<Held | null>({
    label: "transport.server",
    initial: null,
  });

  /**
   * The server. Its start gives `{ upgrade, websocket }`: the host calls `upgrade` from its fetch
   * (undefined: not this path; null: upgraded, Bun owns the request now) and passes `websocket`
   * to `Bun.serve`.
   */
  const server = capsule({
    label: "ws.server",
    config: {
      path: path.required,
      origin,
      codec,
      services,
      strict,
      maxPayload,
      maxWatches,
      maxUploads,
      uploadDeadline,
    },
    hooks: {
      async start({ config, load, next, raise, log }) {
        const allowed = config.origin === null ? "" : String(URL.parse(config.origin)?.origin);
        if (!/^(https?:\/\/|$)/.test(allowed)) {
          raise("MissingConfig", { label: "ws.server", key: "origin" });
        }
        const p = await load(protocol, kept);
        const routesOf = p.routesOf(config.services, raise as never, log, config.strict);
        /** The addresses that take bytes, with their limits, from the service that owns each. */
        const uploadsAt = new Map(
          [...routesOf].flatMap(([address, one]) => {
            const limit = one.uploads?.[address];
            return limit ? [[address, limit] as const] : [];
          }),
        );
        load(held, kept).set({ side: { routes: routesOf }, codec: config.codec, protocol: p });
        await next();

        const upgrade = (
          req: Request,
          scope: Scope.Handle,
          bun: Server<Socket>,
        ): Response | null | undefined => {
          const url = new URL(req.url);
          if (url.pathname !== config.path) return undefined;
          if (![null, new URL(allowed, url).origin].includes(req.headers.get("origin"))) {
            return new Response(null, { status: 403 });
          }
          // Per socket: its request, scope, live watches, this tick's frame, and its steps.
          const own: Socket = {
            req,
            scope,
            gone: new AbortController(),
            watches: new Map(),
            out: [],
            /** Queues one message; the first of a tick schedules the frame. */
            emit(ws, message) {
              if (own.gone.signal.aborted || own.out.push(message) > 1) return;
              // setImmediate, not setTimeout(0): Bun waits at least 1 ms for a timer (measured: +1.1 ms
              // and +11% CPU on a lone call). The answers of one tick still go as one frame.
              setImmediate(() => {
                if (!own.gone.signal.aborted) ws.send(JSON.stringify(own.out.splice(0)));
              });
            },
            pusher(ws, i) {
              return (t: string) => own.emit(ws, { i, t });
            },
            /** One message: a stop, or a call or watch that fits. */
            async one(ws, m) {
              if (m.x) return own.watches.get(m.i)?.abort();
              const bad = typeof m.a !== "string" || typeof m.t !== "string";
              const full = !!m.w && own.watches.size >= config.maxWatches;
              if (bad || full) return own.emit(ws, { i: m.i, e: bad ? 400 : 429 });
              return own.run(ws, m);
            },
            /**
             * A call or a watch, in its own session of the scope. A watch's stop is kept before the
             * first await, so a stop in the same frame finds it.
             */
            async run(ws, m) {
              const { meta, execution } = idOff(Object(m.m));
              const trace = traceparentOf(meta.traceparent);
              // Only a watch has a stop of its own: a call ends with its answer, or with the socket.
              const stop = m.w ? new AbortController() : undefined;
              if (stop) own.watches.set(m.i, stop);
              const left = AbortSignal.any(
                stop ? [stop.signal, own.gone.signal] : [own.gone.signal],
              );
              const tags = [request(req), requestStop(left)];
              const session = await Promise.resolve()
                .then(() => scope.createSession({ trace, tags }))
                .catch(() => null);
              if (!session) return (own.watches.delete(m.i), own.emit(ws, { i: m.i, e: 503 }));

              const input = { address: String(m.a), text: String(m.t), meta, execution };
              if (!m.w) {
                const reply = await session.run(serve, { input }).finally(() => session.close());
                return own.emit(ws, reply === null ? { i: m.i, e: 404 } : { i: m.i, t: reply });
              }
              const push = own.pusher(ws, m.i);
              const served = () => session.run(serveStream, { input: { ...input, left, push } });
              return own.watch(ws, m, left, served).finally(() => session.close());
            },
            /**
             * A watch, until its key ends, its stop, or the socket's end. One stopped while its
             * session opened serves nothing (ADR 0090: an aborted signal starts no body): its key
             * would wait on a `closed` that aborted before it looked.
             */
            async watch(ws, m, left, served) {
              await Promise.resolve(left.aborted || served())
                .then((found) => own.emit(ws, found ? { i: m.i, end: 1 } : { i: m.i, e: 404 }))
                .catch((error) => {
                  log.error("ws stream failed", { address: m.a, cause: String(error) });
                  own.emit(ws, { i: m.i, end: 1 });
                })
                .finally(() => own.watches.delete(m.i));
            },
          };
          return bun.upgrade(req, { data: own }) ? null : new Response(null, { status: 426 });
        };

        /** The bytes POSTs running now. */
        let uploading = 0;

        /**
         * A bytes POST: undefined when it is not one (not this path), else the reply. The guards
         * run in the order of the comment at the top; the body is read only by the implementation.
         */
        const post = async (req: Request, scope: Scope.Handle): Promise<Response | undefined> => {
          const url = new URL(req.url);
          const address = decodeURIComponent(url.pathname.slice(config.path.length + 1));
          const limit = uploadsAt.get(address);
          if (req.method !== "POST" || !url.pathname.startsWith(`${config.path}/`)) return;

          const busy = uploading >= config.maxUploads;
          const origin = new URL(allowed, url).origin;
          const admitted = await scope.run(admit, { input: { req, limit, origin, busy } });
          if (admitted instanceof Response) return admitted;

          const { text, type } = admitted;
          const { meta, execution } = idOff(admitted.meta);
          const stop = AbortSignal.any([req.signal, AbortSignal.timeout(config.uploadDeadline)]);
          const trace = traceparentOf(meta.traceparent);
          const tags = [request(req), requestStop(stop)];
          const session = await Promise.resolve()
            .then(() => scope.createSession({ trace, tags }))
            .catch(() => null);
          if (!session) return new Response(null, { status: 503, headers: refused });

          uploading += 1;
          const body = session.run(bodyOf, { input: { req, max: limit!.max, type, stop } });
          const reply = await session
            .run(serve, { input: { address, text, meta, body, execution } })
            .finally(() => {
              uploading -= 1;
              // An unread body is cancelled; a read one is locked, and its cancel is a no-op.
              void req.body?.cancel().catch(() => undefined);
              return session.close();
            });
          if (body.over) return new Response(null, { status: 413, headers: refused });
          if (reply === null) return new Response(null, { status: 404 });
          return new Response(reply, {
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        };

        const websocket: WebSocketHandler<Socket> = {
          maxPayloadLength: config.maxPayload,
          backpressureLimit: config.maxPayload,
          closeOnBackpressureLimit: true,
          idleTimeout: 60,
          sendPings: true,
          message(ws, frame) {
            const all = Promise.resolve(typeof frame === "string" ? frame : "")
              .then((text) => JSON.parse(text) as Msg[])
              .catch(() => null);
            void all.then((msgs) => {
              const fits =
                Array.isArray(msgs) &&
                msgs.length <= frameMax &&
                msgs.every((m) => Number.isSafeInteger(Object(m).i));
              if (!fits) return ws.close(1008, "bad frame");
              for (const m of msgs) {
                void ws.data
                  .one(ws, m)
                  .catch((error) => log.error("ws message failed", { error: String(error) }));
              }
            });
          },
          close(ws) {
            ws.data.gone.abort(new Error("socket closed"));
          },
        };
        /** The largest body any key takes: the host sets Bun's `maxRequestBodySize` from it. */
        const maxBody = Math.max(
          0,
          ...[...routesOf.values()]
            .flatMap((one) => Object.values(one.uploads ?? {}))
            .map((l) => l.max),
        );
        /** The handler `serve` asks: the socket's path, then a bytes POST; else not ours. */
        const fetch = async (req: Request, scope: Scope.Handle, bun: Server<never>) => {
          const upgraded = upgrade(req, scope, bun as never);
          return upgraded === undefined ? post(req, scope) : upgraded;
        };
        return { upgrade, post, fetch, websocket, maxBody };
      },
      /** Every run of the scope passes here: one that is not this transport's reads `op` only. */
      run(event): unknown {
        const { op, call: invocation } = event;
        if (op !== serve && op !== serveStream) return event.next();

        const own = event.load(held, kept).get()!;
        const input = (invocation?.input ?? invocation?.rawInput) as StreamIn;
        return serveText(own, new Tools(event), op === serve, input);
      },
    },
  });

  return {
    server: server as unknown as Omit<typeof server, never> & {
      (values: ServerConfig): ReturnType<typeof server>;
    },
  };
}

/** The default WebSocket server. */
export const ws = createWs();
