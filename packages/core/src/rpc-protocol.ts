import { resource } from "./index";
import type { Observe, Operation, Resource } from "./index";
import type * as z from "./rpc-shape";
import { lost } from "./rpc-wire";
import type { callInput, Open, Reply, Send, Service } from "./rpc-wire";

// The protocol (ADR 0154): the meaning every backend shares, in values. The route table, `meta`
// and one `renew` at a time, a throw as `failed`, and the server's `answer` and `stream`. It
// never sees text: the codec, the envelope and the frames are each backend's own (ADR 0140), as
// each tRPC link owns its transformer use and its frames.

/**
 * `meta`: an op the client runs before each call and each stream open; its pairs go beside the
 * body (headers). As tRPC's `headers()` or a gRPC call credential.
 * `renew`: runs when a call or a push is `refused`, as OkHttp's Authenticator runs on a 401.
 * True means "try once more" (the next `meta` has fresh credentials). One renew at a time per
 * backend: calls refused together wait for the same one (single flight).
 */
export type MetaOp = Operation.Handle<Promise<Record<string, string>>, void>;

export type RenewOp = Operation.Handle<
  Promise<boolean>,
  { payload: unknown; sent: Record<string, string> }
>;

/** What a backend's client holds once started: its value ops and the options it was given. */
export type ClientSide = {
  readonly send: Send;
  readonly open: Open;
  readonly meta?: MetaOp;
  readonly renew?: RenewOp;
};

/** What a backend's server holds once started: its route table. */
export type ServerSide = { readonly routes: ReadonlyMap<string, Service> };

/**
 * The hook's own tools: run (with a handler note), log, and the call's signal. The protocol reads
 * `log` only when it logs a fault, so a backend can make it on that read.
 */
export type Hook = {
  readonly run: (op: never, options: never, why: never) => unknown;
  readonly log: Observe.Logger;
  readonly signal: AbortSignal | undefined;
};

/** Where a started backend keeps its side. */
export const kept = { role: "state", explain: "The transport's own side" } as const;

/** The renew in flight, per client side. */
const renewing = new WeakMap<object, Promise<boolean>>();

type Failed = Extract<Reply, { ok: false }>;
/** One value out, as rpc and remoteData give it. */
type Asked = z.infer<typeof callInput>;

const why = { role: "handler", explain: "One layer down" } as const;

/** Optional config, read as plain values. */
type Maybe<T> = { readonly present: boolean; readonly value?: T };

/**
 * The protocol's steps, for each backend's capsules: the client's `callOver` and `watchOver`, the
 * server's `answer` and `stream`, and the route table. One per root; it holds nothing of its own.
 */
export const protocol = resource({
  label: "protocol",
  target: "scope",
  factory: () => {
    const run = <T>(hook: Hook, op: unknown, options: unknown) =>
      Promise.resolve(hook.run(op as never, options as never, why as never) as T);

    /** W3C traceparent from a span: the client transport sends its own span (ADR 0076). */
    const traceparent = (
      span: { traceId: string; spanId: string; sampled: boolean } | undefined,
    ): Record<string, string> =>
      span
        ? { traceparent: `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}` }
        : {};

    const given = <T>(slot: Maybe<T>): T | undefined => (slot.present ? slot.value : undefined);

    /**
     * The route table: built once at start. Two services with one address fail the start with
     * DuplicateAddress, as tRPC `mergeRouters` and Fastify do: two boards with one cell name
     * mixed their data (acountee, 2026-11-13). `strict: false` is the old rule: the first in
     * the list wins and start logs a warning, as Hono does (Duke 2026-11-06 04:21).
     */
    const named = (service: Service, address: string) =>
      String(service.names?.(address) || service.label);

    const routesOf = (
      services: readonly Service[],
      raise: (kind: string, payload: unknown) => never,
      log: Observe.Logger,
      strict: boolean,
    ) => {
      const table = new Map<string, Service>();
      for (const service of services) {
        for (const address of service.addresses) {
          const taken = table.get(address);
          if (!taken) {
            table.set(address, service);
            continue;
          }

          const label = named(service, address);
          const pair = { address, services: [named(taken, address), label] };
          if (strict) raise("DuplicateAddress", pair);
          log.warn("protocol duplicate address", {
            address,
            winner: pair.services[0],
            shadowed: label,
          });
        }
      }

      return table;
    };

    /** Client: the meta for a request, and the shared renew. */
    const asking = async (own: ClientSide, hook: Hook, given: Record<string, string>) => {
      const metaNow = async () =>
        own.meta ? { ...given, ...(await run<Record<string, string>>(hook, own.meta, {})) } : given;
      const meta = await metaNow();

      /** Refused: ask `renew` once (shared by the calls refused at the same time). */
      const renewed = (payload: unknown, sent: Record<string, string>): Promise<boolean> => {
        const renew = own.renew;
        if (!renew) return Promise.resolve(false);
        const live = renewing.get(own);
        if (live) return live;

        const once = run<boolean>(hook, renew, { input: { payload, sent } })
          .catch(() => false)
          .finally(() => renewing.delete(own));
        renewing.set(own, once);
        return once;
      };
      return { meta, metaNow, renewed };
    };

    /** Client: one value out, the reply back as a value. A fault is data too; only a bug throws. */
    const callOver = async (own: ClientSide, hook: Hook, input: Asked): Promise<Reply> => {
      const { meta, metaNow, renewed } = await asking(own, hook, input.meta);
      const ask = (m: Record<string, string>): Promise<Reply> =>
        run<Reply>(hook, own.send, { input: { ...input, meta: m }, signal: hook.signal }).catch(
          bug(hook, input.address),
        );
      const first = await ask(meta);
      if (first.ok || first.kind !== "refused" || !(await renewed(first.payload, meta))) {
        return first;
      }

      return metaNow().then(ask); // once only: a second refusal is the answer
    };

    /**
     * Client: one value out; replies pushed until the signal aborts or the stream ends. Core's
     * `AbortError` from the open is the call's own stop: its session closed (ADR 0133 d1). That
     * ends the stream clean, as a leave does; no bug, no `failed`.
     */
    const watchOver = async (
      own: ClientSide,
      hook: Hook,
      input: Asked & { push: (reply: Reply) => void },
    ): Promise<void> => {
      const { signal } = hook;
      const { meta, renewed } = await asking(own, hook, input.meta);
      const got = (reply: Reply) => {
        // A refused push starts a renew; the watch's own retry then opens with fresh meta.
        if (!reply.ok && reply.kind === "refused") void renewed(reply.payload, meta);
        input.push(reply);
      };

      // One exit, after the pushes: a fault that ends it is pushed last.
      const end = await run<{ ok: true } | Failed>(hook, own.open, {
        input: { ...input, meta, push: got },
        signal,
      }).catch((error: unknown) =>
        Object(error).name === "AbortError"
          ? { ok: true as const }
          : bug(hook, input.address)(error),
      );
      if (!end.ok && !signal?.aborted) input.push(end);
    };

    /** A service that throws (a bug: rpc and remoteData turn their own throws into `failed`): `failed` too, never a silent end. */
    const broke =
      (hook: Hook, address: string, side?: "client") =>
      (error: unknown): Failed => {
        hook.log.error("protocol service failed", {
          address,
          cause: String(error),
          stack: String(Object(error).stack ?? ""),
        });
        return { ok: false, kind: "failed", payload: side ? { side } : {} };
      };

    /**
     * A backend that throws: a bug (ADR 0141), logged with the trace, and `failed` on this side;
     * never `link`, so nothing asks again. A throw after the caller stopped is the stop.
     */
    const bug = (hook: Hook, address: string) => (error: unknown) =>
      hook.signal?.aborted
        ? lost({ ok: false, kind: "link", sent: true })
        : broke(hook, address, "client")(error);

    /** Server: one value in, the reply out; null when no service has the address (`missing`). */
    const answer = async (own: ServerSide, hook: Hook, input: Asked): Promise<Reply | null> => {
      const service = own.routes.get(input.address);
      if (!service) return null;

      return run<Reply | null>(hook, service.answer, { input, signal: hook.signal }).catch(
        broke(hook, input.address),
      );
    };

    /** Server: one watched address, its pushes as replies, until the client leaves. */
    const stream = async (
      own: ServerSide,
      hook: Hook,
      input: Asked & { push: (reply: Reply) => void; left?: AbortSignal },
    ): Promise<boolean> => {
      const service = own.routes.get(input.address);
      // No one has this address: false, and the backend says it its own way (ws: a 404 frame).
      if (!service) return false;

      return run<boolean>(hook, service.stream, { input }).catch(
        (error) => (input.push(broke(hook, input.address)(error)), true),
      );
    };

    return {
      run,
      traceparent,
      given,
      routesOf,
      asking,
      callOver,
      watchOver,
      broke,
      answer,
      stream,
    };
  },
});

/** The protocol's steps, as one root holds them. */
export type Protocol = typeof protocol extends Resource.Handle<infer T> ? Awaited<T> : never;
