import { data, extension, operation, resource, tag, type Operation } from "@tinker/core";
import { HttpRequest, send } from "@tinker/http";
import type { Sync } from "@tinker/sync";
import { fail } from "../errors.ts";
import { connection } from "./state.ts";

export declare namespace Wire {
  /** One server-sent stream as the wire uses it: the browser's `EventSource` fits it, and a test
   * binds a fake that behaves alike. */
  type Source = {
    onopen: ((event: Event) => void) | null;
    onerror: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    close(): void;
  };
  /** One sync message POSTed for one tab: the client id pairs it with the tab's stream. */
  type Post = { readonly id: string; readonly message: Sync.Message };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

/** Admit one wire frame: a snapshot for a key at a version. Anything else is refused. */
function readMessage(raw: unknown): Sync.Message {
  if (!isRecord(raw)) throw fail("SyncDropped", { reason: "bad snapshot" });
  if (raw.type !== "snapshot") throw fail("SyncDropped", { reason: "bad snapshot" });
  if (typeof raw.key !== "string") throw fail("SyncDropped", { reason: "bad snapshot" });
  if (typeof raw.version !== "number") throw fail("SyncDropped", { reason: "bad snapshot" });
  return { type: "snapshot", key: raw.key, version: raw.version, value: raw.value };
}

/** Admit one server-sent frame: a JSON string carrying a snapshot message. */
function readData(event: MessageEvent): Sync.Message {
  if (typeof event.data !== "string") throw fail("SyncDropped", { reason: "bad snapshot" });
  let raw: unknown;
  try {
    raw = JSON.parse(event.data);
  } catch {
    throw fail("SyncDropped", { reason: "bad snapshot" });
  }
  return readMessage(raw);
}

/** How the wire opens one server-sent stream: the browser's `EventSource`, rebound in a test. */
export const openSource = tag<(url: string) => Wire.Source>({
  label: "openSource",
  default: (url) => new EventSource(url),
});

/** The near end of the `memoryPair` whose far end sync holds, bound once at the composition
 * root: the steady handle sync keeps while the wire rewires under it (ADR 0048, 0070). */
export const wirePeer = tag<Sync.Transport>({ label: "wirePeer" });

/** The reconnect intent: a count the `reconnect` operation bumps. The wire opens a fresh stream
 * on each bump; nothing calls the wire (ADR 0070). */
export const retry = data<number>({ label: "wire.retry", initial: 0 });

/** How long a dropped wire waits before it opens again by itself. */
const BACKOFF_MS = 1000;

/** The wire's health as the `connection` cell holds it; the wire is its one writer. */
const HEALTH = {
  connecting: { live: false, pending: true, failed: false, closedBadly: false },
  live: { live: true, pending: false, failed: false, closedBadly: false },
  dropped: { live: false, pending: false, failed: false, closedBadly: false },
  failed: { live: false, pending: false, failed: true, closedBadly: false },
};

/** POST one sync message for one tab through HTTP; the server hands it to the tab's stream. */
export const postSync = operation({
  label: "issues.postSync",
  depends: { send },
  run: async ({ send: sendIt }, ctx: Operation.Ctx<Wire.Post>) => {
    await sendIt.run({
      input: HttpRequest.post(`/sync?client=${ctx.input.id}`, {
        body: HttpRequest.bodyJson(ctx.input.message),
      }),
    });
  },
});

/** The tab's link (ADR 0070): one resource that owns the current `Wire.Source` under one client
 * id from `ctx.random`, writes the `connection` health, and rewires itself.
 * - Opening a stream writes connecting; its open writes live.
 * - An error before the open writes failed. On the first stream it also closes sync's pair, so
 *   sync rejects `ready` and the boot fails.
 * - A later error, a malformed frame, or a refused POST writes dropped. The wire watches its
 *   health: on dropped it waits `BACKOFF_MS` on `ctx.clock` with `ctx.signal`, then opens again.
 *   A close aborts the wait quietly.
 * - A bump of `retry` opens a fresh stream now.
 * - Each rewire replays the last register the wire kept from sync.
 * Sync's messages POST behind the current stream's open, in send order; a failed POST drops the
 * wire only while the stream it was sent for is still current. Closing a stream that has
 * not opened rejects its open, so nothing waits on it. Sync closing its end closes the stream.
 * `defer` closes the stream and stops every watch; `ctx.signal` aborts in-flight POSTs. */
export const wire = resource({
  label: "wire",
  depends: {
    open: openSource,
    post: postSync,
    peer: wirePeer,
    health: connection.controller,
    intent: retry.controller,
  },
  factory: ({ open, post, peer, health, intent }, { defer, signal, random, clock }) => {
    const id = random.uuid();
    let current: Wire.Source | null = null;
    let gate: Promise<void> = Promise.resolve();
    let abandon: () => void = () => undefined;
    let registered: Sync.Message | null = null;

    const shut = (): void => {
      abandon();
      current?.close();
      current = null;
    };
    const drop = (): void => {
      shut();
      health.set(HEALTH.dropped);
    };
    const receive = (source: Wire.Source, event: MessageEvent): void => {
      if (source !== current) return;
      let message: Sync.Message;
      try {
        message = readData(event);
      } catch {
        drop();
        return;
      }
      peer.send(message);
    };
    const openNext = (failed: () => void): void => {
      shut();
      health.set(HEALTH.connecting);
      const source = open(`/sync?client=${id}`);
      current = source;
      gate = new Promise<void>((resolve, reject) => {
        abandon = () => reject(fail("SyncDropped", { reason: "stream closed" }));
        source.onerror = () => {
          if (source !== current) return;
          health.set(HEALTH.failed);
          failed();
          shut();
        };
        source.onopen = () => {
          if (source !== current) return;
          source.onerror = () => {
            if (source === current) drop();
          };
          health.set(HEALTH.live);
          resolve();
        };
        source.onmessage = (event) => receive(source, event);
      });
    };
    const deliver = async (source: Wire.Source | null, message: Sync.Message): Promise<void> => {
      if (signal.aborted) return;
      const sent = await post.settle({ input: { id, message } });
      if (sent.status !== "success" && signal.aborted === false && source === current) drop();
    };
    const send = (message: Sync.Message): Promise<void> => {
      const source = current;
      return gate.then(
        () => deliver(source, message),
        () => undefined,
      );
    };
    const rewire = async (): Promise<void> => {
      if (signal.aborted) return;
      openNext(() => undefined);
      if (registered !== null) await send(registered);
    };
    const backOff = async (): Promise<void> => {
      const waited = await clock.sleep(BACKOFF_MS, signal).then(
        () => true,
        () => false,
      );
      if (waited === false || signal.aborted) return;
      if (health.get() === HEALTH.dropped) await rewire();
    };

    defer(
      peer.onMessage(async (message) => {
        if (message.type === "register") registered = message;
        await send(message);
      }),
    );
    defer(peer.onClose(shut));
    defer(
      health.watch(async (next) => {
        if (next === HEALTH.dropped) await backOff();
      }),
    );
    defer(intent.watch(rewire));
    defer(shut);
    openNext(() => peer.close());
    return { id };
  },
});

/** Resolve the wire before sync starts (ADR 0070 rule 2): sync's `start` registers through its
 * end of the pair, and the wire must already hear the near end. Install it before `subscribe`. */
export const linkWire = extension({
  label: "linkWire",
  start: (scope, _ctx, next) => {
    scope.resolve(wire);
    return next();
  },
});
