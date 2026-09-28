import { data, resource, tag } from "@tinker/core";
import type { Sync } from "@tinker/sync";
import { fail } from "../errors.ts";
import { connection } from "./state.ts";

export declare namespace Wire {
  /** One server-sent stream as the wire uses it: the browser's `EventSource` fits it, and a test
   * binds a fake that behaves alike. `readyState` is `EventSource`'s: 2 once the browser has
   * given up on the stream. */
  type Source = {
    readonly readyState: number;
    onopen: ((event: Event) => void) | null;
    onerror: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    close(): void;
  };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

function readMessage(raw: unknown): Sync.Message {
  if (!isRecord(raw)) throw fail("SyncDropped", { reason: "bad snapshot" });
  if (raw.type !== "snapshot") throw fail("SyncDropped", { reason: "bad snapshot" });
  if (typeof raw.key !== "string") throw fail("SyncDropped", { reason: "bad snapshot" });
  if (typeof raw.version !== "number") throw fail("SyncDropped", { reason: "bad snapshot" });
  return { type: "snapshot", key: raw.key, version: raw.version, value: raw.value };
}

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

/** `EventSource.CLOSED`: the browser gave up on the stream and will not reconnect it. */
const CLOSED = 2;

/** The wire's health as the `connection` cell holds it; the wire is its one writer. */
const HEALTH = {
  connecting: { live: false, pending: true, failed: false },
  live: { live: true, pending: false, failed: false },
  failed: { live: false, pending: false, failed: true },
};

function listen<T>(target: Set<T>, listener: T): () => void {
  target.add(listener);
  return () => {
    target.delete(listener);
  };
}

/** The tab's link (ADR 0070) and the `Sync.Transport` sync holds: one resource that owns the
 * current `Wire.Source`, writes the `connection` health, and swaps streams under the steady
 * transport it returns. Its listener sets are the ones the transport contract demands (ADR 0070
 * rule 4). The browser reconnects a stream by itself, and each reconnect is a fresh GET with the
 * keys, so the server registers again and sends a fresh snapshot.
 * - `send(register)` adds its keys and opens a stream on `/sync?keys=…`: connecting.
 * - An open writes live. An error while the browser retries writes connecting.
 * - An error once the browser gave up (`readyState` CLOSED: the server answered an HTTP error),
 *   or a malformed frame, closes the stream and writes failed. Before the first frame it also
 *   closes the transport, so sync rejects `ready` and the boot fails.
 * - A bump of `retry` opens a fresh stream now.
 * - Each frame reaches every message listener.
 * `close` closes the stream, fires the close listeners once, and opens nothing after; `defer`
 * closes and stops the retry watch. */
export const wire = resource({
  label: "wire",
  depends: { open: openSource, health: connection.controller, intent: retry.controller },
  factory: ({ open, health, intent }, { defer }): Sync.Transport => {
    const arrivals = new Set<(message: Sync.Message) => void>();
    const partings = new Set<() => void>();
    const keys = new Set<string>();
    let current: Wire.Source | null = null;
    let heard = false;
    let closed = false;

    const close = (): void => {
      if (closed) return;
      closed = true;
      current?.close();
      for (const parted of partings) parted();
    };
    const giveUp = (): void => {
      current?.close();
      health.set(HEALTH.failed);
      if (!heard) close();
    };
    const receive = (event: MessageEvent): void => {
      let message: Sync.Message;
      try {
        message = readData(event);
      } catch {
        giveUp();
        return;
      }
      heard = true;
      for (const arrival of arrivals) arrival(message);
    };
    const connect = (): void => {
      if (closed) return;
      current?.close();
      health.set(HEALTH.connecting);
      const query = new URLSearchParams([...keys].map((key) => ["keys", key]));
      const source = open(`/sync?${query}`);
      current = source;
      source.onopen = () => health.set(HEALTH.live);
      source.onerror = () => {
        if (source.readyState === CLOSED) giveUp();
        else health.set(HEALTH.connecting);
      };
      source.onmessage = receive;
    };

    defer(intent.watch(connect));
    defer(close);
    return {
      send: (message) => {
        if (message.type !== "register") return;
        for (const key of message.keys) keys.add(key);
        connect();
      },
      onMessage: (listener) => listen(arrivals, listener),
      onClose: (listener) => listen(partings, listener),
      close,
    };
  },
});
