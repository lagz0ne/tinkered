import { tag } from "@tinker/core";
import type { Sync } from "@tinker/sync";
import { fail } from "../errors.ts";

/** The reconnecting tab wire: a `Sync.Transport` over one `EventSource` at a time whose drops
 * stay silent (so `subscribe` stays attached and local cells survive) while its `status` tells
 * the tab what the wire is doing. `reconnect` opens a fresh stream and replays the last register. */
export type ReconnectingWire = Sync.Transport & {
  /** The wire's current state: live once the first stream opens, dropped after a stream error,
   * connecting while a reconnect is in flight, failed when a reconnect fails. */
  readonly status: () => WireStatus;
  /** Watch status changes; the returned closer stops watching. */
  readonly onStatus: (listener: (status: WireStatus) => void) => () => void;
  /** Open a fresh stream and replay the last register; flips live, or failed on error. */
  readonly reconnect: () => Promise<void>;
};

/** The wire's state as the tab reads it. */
export type WireStatus = "live" | "dropped" | "connecting" | "failed";

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
export function readData(event: MessageEvent): Sync.Message {
  if (typeof event.data !== "string") throw fail("SyncDropped", { reason: "bad snapshot" });
  let raw: unknown;
  try {
    raw = JSON.parse(event.data);
  } catch {
    throw fail("SyncDropped", { reason: "bad snapshot" });
  }
  return readMessage(raw);
}

/** Open the tab's wire: one `EventSource` at a time; `send` POSTs queued in order (the last
 * register is remembered and replayed on reconnect); a stream error flips to dropped without
 * firing `onClose` (so `subscribe` stays attached); the first error before live fires `onClose`
 * once (so `subscribe.start` rejects with `SyncNotReady` and `ready` rejects); `close` (called
 * by `subscribe` on scope close) aborts in-flight POSTs, closes the stream, and fires `onClose`. */
export function reconnectingTransport(baseUrl: string): ReconnectingWire {
  const id = Math.random().toString(36).slice(2);
  const url = `${baseUrl}/sync?client=${id}`;
  let status: WireStatus = "connecting";
  const watchers = new Set<(status: WireStatus) => void>();
  const arrivals = new Set<(message: Sync.Message) => void>();
  const partings = new Set<() => void>();
  const flight = new AbortController();
  let stream: EventSource | null = null;
  let lastRegister: Sync.Message | null = null;
  let queue: Promise<void> = Promise.resolve();
  let settled = false;
  let closed = false;

  function flip(next: WireStatus): void {
    status = next;
    for (const watcher of Array.from(watchers)) watcher(next);
  }

  function fireClose(): void {
    for (const parting of Array.from(partings)) parting();
  }

  function drop(): void {
    if (closed) return;
    if (settled === false) {
      settled = true;
      flip("failed");
      fireClose();
      return;
    }
    if (status === "live" || status === "failed") flip("dropped");
  }

  function open(): EventSource {
    const next = new EventSource(url);
    stream = next;
    next.onopen = () => {
      if (closed || stream !== next) return;
      settled = true;
      flip("live");
    };
    next.onerror = () => {
      if (closed || stream !== next) return;
      stream = null;
      next.close();
      drop();
    };
    next.onmessage = (event) => {
      if (closed || stream !== next) return;
      let message: Sync.Message;
      try {
        message = readData(event);
      } catch {
        drop();
        return;
      }
      for (const arrival of Array.from(arrivals)) arrival(message);
    };
    return next;
  }

  open();

  const post = async (message: Sync.Message, signal: AbortSignal): Promise<void> => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
        signal,
      });
    } catch {
      if (closed || signal.aborted) return;
      drop();
      return;
    }
    if (!res.ok && closed === false && signal.aborted === false) drop();
  };

  return {
    send: (message) => {
      if (closed) return;
      if (message.type === "register") lastRegister = message;
      queue = queue.then(() => post(message, flight.signal));
    },
    onMessage: (listener) => {
      arrivals.add(listener);
      return () => {
        arrivals.delete(listener);
      };
    },
    onClose: (listener) => {
      partings.add(listener);
      return () => {
        partings.delete(listener);
      };
    },
    close: () => {
      if (closed) return;
      closed = true;
      flight.abort();
      stream?.close();
      stream = null;
      fireClose();
    },
    status: () => status,
    onStatus: (listener) => {
      watchers.add(listener);
      return () => {
        watchers.delete(listener);
      };
    },
    reconnect: async () => {
      if (closed) return;
      flip("connecting");
      stream?.close();
      stream = null;
      const next = open();
      await new Promise<void>((resolve, reject) => {
        next.onopen = () => resolve();
        next.onerror = () => reject(fail("SyncDropped", { reason: "reconnect failed" }));
      }).catch(() => {
        if (closed || stream !== next) return;
        stream = null;
        drop();
        return;
      });
      if (closed || stream !== next) return;
      settled = true;
      flip("live");
      const replay = lastRegister;
      if (replay !== null) queue = queue.then(() => post(replay, flight.signal));
    },
  };
}

/** The tab's wire: bound once at the composition root, rebound in a test. */
export const wire = tag<ReconnectingWire>({ label: "wire" });
