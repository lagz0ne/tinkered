import type { Sync } from "./index.ts";

export declare namespace Sse {
  /** The caller owns the HTTP stream; closing this transport notifies its owner through
   * `onClose`. Deliver only messages already checked by the route. */
  type Server = Sync.Transport & { deliver(message: Sync.Message): void };
  /** The browser's EventSource fits this shape; tests can open a fake source. */
  type Source = {
    readonly readyState: number;
    onopen: ((event: Event) => void) | null;
    onerror: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    close(): void;
  };
  type State = "connecting" | "live" | "failed";
  type Client = {
    /** Open a fresh stream with every registered key, including on an explicit retry.
     * The client takes ownership of the returned source. URL and POST choices stay here. */
    open(keys: readonly string[]): Source;
    onState?(state: State): void;
    /** Listen for a retry intent. Closing the transport calls the returned unsubscribe. */
    onRetry?(reconnect: () => void): () => void;
  };
}

function listen<T>(target: Set<T>, listener: T): () => void {
  target.add(listener);
  return () => {
    target.delete(listener);
  };
}

/** Frame messages for a plain chunk writer, without owning an HTTP framework.
 * A failed write or an abort parts the wire once; a late close listener learns it already closed. */
export function createSseServer(write: (chunk: string) => void, signal: AbortSignal): Sse.Server {
  const arrivals = new Set<(message: Sync.Message) => void>();
  const partings = new Set<() => void>();
  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", close);
    for (const parted of Array.from(partings)) parted();
    partings.clear();
    arrivals.clear();
  }
  signal.addEventListener("abort", close, { once: true });
  if (signal.aborted) close();
  return {
    send: (message) => {
      if (closed) return;
      try {
        write(`data: ${JSON.stringify(message)}\n\n`);
      } catch {
        close();
      }
    },
    deliver: (message) => {
      if (closed) return;
      for (const arrival of Array.from(arrivals)) arrival(message);
    },
    onMessage: (listener) => listen(arrivals, listener),
    onClose: (listener) => {
      if (closed) {
        listener();
        return () => undefined;
      }
      return listen(partings, listener);
    },
    close,
  };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

function readSnapshot(raw: unknown): Sync.Message | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.type !== "snapshot") return undefined;
  if (typeof raw.key !== "string") return undefined;
  if (typeof raw.version !== "number") return undefined;
  return { type: "snapshot", key: raw.key, version: raw.version, value: raw.value };
}

function readData(data: unknown): Sync.Message | undefined {
  if (typeof data !== "string") return undefined;
  try {
    return readSnapshot(JSON.parse(data));
  } catch {
    return undefined;
  }
}

/** One steady transport over replaceable streams (ADR 0070).
 * Browser retries stay connecting. CLOSED or a bad frame fails the stream; before the first
 * snapshot it also closes the transport. After that, a retry intent can open a fresh stream. */
export function createSseClient(options: Sse.Client): Sync.Transport {
  const arrivals = new Set<(message: Sync.Message) => void>();
  const partings = new Set<() => void>();
  const keys = new Set<string>();
  let current: Sse.Source | undefined;
  let heard = false;
  let closed = false;

  function closeSource(): void {
    if (current === undefined) return;
    current.onopen = null;
    current.onerror = null;
    current.onmessage = null;
    current.close();
    current = undefined;
  }
  function close(): void {
    if (closed) return;
    closed = true;
    closeSource();
    stopRetry?.();
    for (const parted of Array.from(partings)) parted();
    partings.clear();
    arrivals.clear();
  }
  function giveUp(): void {
    closeSource();
    options.onState?.("failed");
    if (!heard) close();
  }
  function receive(event: MessageEvent): void {
    const message = readData(event.data);
    if (message === undefined) {
      giveUp();
      return;
    }
    heard = true;
    for (const arrival of Array.from(arrivals)) arrival(message);
  }
  function connect(): void {
    if (closed) return;
    closeSource();
    options.onState?.("connecting");
    const source = options.open([...keys]);
    current = source;
    source.onopen = () => options.onState?.("live");
    source.onerror = () => {
      if (source.readyState === 2) giveUp();
      else options.onState?.("connecting");
    };
    source.onmessage = receive;
  }
  const stopRetry = options.onRetry?.(connect);
  return {
    send: (message) => {
      if (message.type !== "register") return;
      for (const key of message.keys) keys.add(key);
      connect();
    },
    onMessage: (listener) => listen(arrivals, listener),
    onClose: (listener) => {
      if (closed) {
        listener();
        return () => undefined;
      }
      return listen(partings, listener);
    },
    close,
  };
}
