import { data, operation, resource, tag, type Operation } from "@tinker/core";
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

/** The reconnect intent: a count the `reconnect` operation bumps. The wire opens a fresh stream
 * on each bump; nothing calls the wire (ADR 0070). */
export const retry = data<number>({ label: "wire.retry", initial: 0 });

/** How long a dropped wire first waits before it opens again by itself; each miss doubles it. */
const BACKOFF_MS = 1000;

/** The longest a dropped wire waits between two tries. */
const BACKOFF_CAP_MS = 30_000;

/** The wire's health as the `connection` cell holds it; the wire is its one writer. */
const HEALTH = {
  connecting: { live: false, pending: true, failed: false },
  live: { live: true, pending: false, failed: false },
  dropped: { live: false, pending: false, failed: false },
  failed: { live: false, pending: false, failed: true },
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

/** Listen until the returned function is called. */
function listen<T>(target: Set<T>, listener: T): () => void {
  target.add(listener);
  return () => {
    target.delete(listener);
  };
}

/** The tab's link (ADR 0070) and the `Sync.Transport` sync holds: one resource that owns the
 * current `Wire.Source` under one client id from `ctx.random`, writes the `connection` health,
 * and rewires itself under the steady transport it returns. Its listener sets are the ones the
 * transport contract demands (ADR 0070 rule 4).
 * - Opening a stream writes connecting; its open writes live.
 * - The first stream's error before its open writes failed and closes the transport, so sync
 *   rejects `ready` and the boot fails.
 * - A rewire's error before its open, a later error, a malformed frame, or a refused POST writes
 *   dropped. The wire watches its health: on dropped it waits on `ctx.clock` with `ctx.signal`,
 *   then opens again. The wait starts at `BACKOFF_MS`, doubles with each drop in a row, and caps
 *   at `BACKOFF_CAP_MS`; an open resets it. A close aborts the wait quietly.
 * - A bump of `retry` opens a fresh stream now and resets the wait; the pending wait opens
 *   nothing.
 * - Each frame reaches every message listener; each rewire replays the last register sync sent.
 * Sync's messages POST behind the current stream's open, in send order; a failed POST drops the
 * wire only while the stream it was sent for is still current. Closing a stream that has
 * not opened rejects its open, so nothing waits on it. `close` closes the stream, fires the close
 * listeners once, and drops later sends. `defer` closes and stops every watch; `ctx.signal`
 * aborts in-flight POSTs. */
export const wire = resource({
  label: "wire",
  depends: {
    open: openSource,
    post: postSync,
    health: connection.controller,
    intent: retry.controller,
  },
  factory: ({ open, post, health, intent }, { defer, signal, random, clock }): Sync.Transport => {
    const id = random.uuid();
    const arrivals = new Set<(message: Sync.Message) => void>();
    const partings = new Set<() => void>();
    let current: Wire.Source | null = null;
    let gate: Promise<void> = Promise.resolve();
    let abandon: () => void = () => undefined;
    let registered: Sync.Message | null = null;
    let wait = BACKOFF_MS;
    let turn = 0;
    let closed = false;

    const shut = (): void => {
      abandon();
      current?.close();
      current = null;
    };
    const close = (): void => {
      if (closed) return;
      closed = true;
      shut();
      for (const parted of partings) parted();
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
      for (const arrival of arrivals) arrival(message);
    };
    const openNext = (missed: () => void): void => {
      shut();
      turn += 1;
      health.set(HEALTH.connecting);
      const source = open(`/sync?client=${id}`);
      current = source;
      gate = new Promise<void>((resolve, reject) => {
        abandon = () => reject(fail("SyncDropped", { reason: "stream closed" }));
        source.onerror = () => {
          if (source !== current) return;
          missed();
        };
        source.onopen = () => {
          if (source !== current) return;
          source.onerror = () => {
            if (source === current) drop();
          };
          wait = BACKOFF_MS;
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
      openNext(drop);
      if (registered !== null) await send(registered);
    };
    const retryNow = async (): Promise<void> => {
      wait = BACKOFF_MS;
      await rewire();
    };
    const backOff = async (): Promise<void> => {
      const waiting = turn;
      const pause = wait;
      wait = Math.min(wait * 2, BACKOFF_CAP_MS);
      const waited = await clock.sleep(pause, signal).then(
        () => true,
        () => false,
      );
      if (waited && turn === waiting) await rewire();
    };

    defer(
      health.watch(async (next) => {
        if (next === HEALTH.dropped) await backOff();
      }),
    );
    defer(intent.watch(retryNow));
    defer(close);
    openNext(() => {
      health.set(HEALTH.failed);
      close();
    });
    return {
      send: async (message) => {
        if (closed) return;
        if (message.type === "register") registered = message;
        await send(message);
      },
      onMessage: (listener) => listen(arrivals, listener),
      onClose: (listener) => listen(partings, listener),
      close,
    };
  },
});
