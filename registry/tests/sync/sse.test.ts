import { expect, test } from "vite-plus/test";
import { createSseClient, createSseServer, type Sse } from "../../src/sync/sse.ts";
import type { Sync } from "../../src/sync/index.ts";

const SNAPSHOT: Sync.Message = { type: "snapshot", key: "counter", version: 3, value: "one\ntwo" };
const REGISTER: Sync.Message = { type: "register", keys: ["counter"] };

/** A stream opened by the injected function; events and state follow EventSource. */
class FakeSource implements Sse.Source {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closes = 0;
  keys: readonly string[];
  constructor(keys: readonly string[]) {
    this.keys = keys;
  }
  close(): void {
    this.closes += 1;
    this.readyState = 2;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  error(state: number): void {
    this.readyState = state;
    this.onerror?.(new Event("error"));
  }
  push(data: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

/** A retry intent with the same watch/unwatch contract as a data controller. */
class Retry {
  stops = 0;
  private listeners = new Set<() => void>();
  watch = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      this.stops += 1;
    };
  };
  bump(): void {
    for (const listener of this.listeners) listener();
  }
}

function createClient() {
  const sources: FakeSource[] = [];
  const states: Sse.State[] = [];
  const retry = new Retry();
  const transport = createSseClient({
    open: (keys) => {
      const source = new FakeSource(keys);
      sources.push(source);
      return source;
    },
    onState: (state) => states.push(state),
    onRetry: retry.watch,
  });
  return { transport, sources, states, retry };
}

test("the SSE server writes one JSON data line and a blank line per message", () => {
  const chunks: string[] = [];
  const wire = createSseServer((chunk) => chunks.push(chunk), new AbortController().signal);
  wire.send(SNAPSHOT);
  expect(chunks).toEqual([
    'data: {"type":"snapshot","key":"counter","version":3,"value":"one\\ntwo"}\n\n',
  ]);
  wire.close();
});

test("the SSE server delivers registers only to active listeners while open", () => {
  const wire = createSseServer(() => undefined, new AbortController().signal);
  const seen: Sync.Message[] = [];
  const stop = wire.onMessage(() => expect.unreachable());
  stop();
  wire.onMessage((message) => seen.push(message));
  wire.deliver(REGISTER);
  wire.close();
  wire.deliver(REGISTER);
  expect(seen).toEqual([REGISTER]);
});

test("a throwing SSE writer closes once and drops later sends", () => {
  let writes = 0;
  let closes = 0;
  const stop = new AbortController();
  const wire = createSseServer(() => {
    writes += 1;
    throw new Error("reader left");
  }, stop.signal);
  wire.onClose(() => {
    closes += 1;
  });
  wire.send(SNAPSHOT);
  wire.send(SNAPSHOT);
  stop.abort();
  wire.close();
  expect({ writes, closes }).toEqual({ writes: 1, closes: 1 });
});

test("aborting the SSE server closes once and stops delivery", () => {
  const stop = new AbortController();
  const wire = createSseServer(() => expect.unreachable(), stop.signal);
  let closes = 0;
  wire.onClose(() => {
    closes += 1;
  });
  wire.onMessage(() => expect.unreachable());
  stop.abort();
  wire.send(SNAPSHOT);
  wire.deliver(REGISTER);
  wire.close();
  expect(closes).toBe(1);
});

test("an already aborted SSE server tells a late listener it is closed", () => {
  const stop = new AbortController();
  stop.abort();
  const wire = createSseServer(() => expect.unreachable(), stop.signal);
  let closes = 0;
  const unlisten = wire.onClose(() => {
    closes += 1;
  });
  unlisten();
  wire.send(SNAPSHOT);
  wire.close();
  expect(closes).toBe(1);
});

test("closing the SSE server notifies every active close listener once", () => {
  const wire = createSseServer(() => undefined, new AbortController().signal);
  const seen: string[] = [];
  const stop = wire.onClose(() => expect.unreachable());
  stop();
  wire.onClose(() => {
    seen.push("first");
    unlisten();
    wire.close();
  });
  const unlisten = wire.onClose(() => seen.push("second"));
  wire.close();
  wire.close();
  expect(seen).toEqual(["first", "second"]);
});

test("the SSE client opens with all registered keys and ignores outgoing snapshots", () => {
  const { transport, sources } = createClient();
  transport.send(SNAPSHOT);
  transport.send(REGISTER);
  transport.send({ type: "register", keys: ["counter", "todo/a & b"] });
  const [first, second] = sources;
  transport.onMessage(() => expect.unreachable());
  first.push(JSON.stringify(SNAPSHOT));
  expect(sources.map((source) => source.keys)).toEqual([["counter"], ["counter", "todo/a & b"]]);
  expect(first.closes).toBe(1);
  expect(second.closes).toBe(0);
  transport.close();
});

test("the SSE client stays connecting on retry errors and becomes live on open", () => {
  const { transport, sources, states } = createClient();
  let closes = 0;
  transport.onClose(() => {
    closes += 1;
  });
  transport.send(REGISTER);
  const [first] = sources;
  first.error(0);
  first.open();
  first.error(1);
  first.open();
  expect(states).toEqual(["connecting", "connecting", "live", "connecting", "live"]);
  expect(closes).toBe(0);
  transport.close();
});

test("a CLOSED SSE source before the first snapshot fails and closes the transport", () => {
  const { transport, sources, states, retry } = createClient();
  let closes = 0;
  transport.onClose(() => {
    closes += 1;
  });
  transport.send(REGISTER);
  const [first] = sources;
  first.error(2);
  retry.bump();
  expect(states).toEqual(["connecting", "failed"]);
  expect(closes).toBe(1);
  expect(first.closes).toBe(1);
  expect(sources).toHaveLength(1);
  transport.close();
});

test("a CLOSED SSE source after a snapshot stays attached and a retry opens a fresh stream", () => {
  const { transport, sources, states, retry } = createClient();
  const seen: Sync.Message[] = [];
  const stop = transport.onMessage(() => expect.unreachable());
  stop();
  transport.onMessage((message) => seen.push(message));
  const stopClose = transport.onClose(() => expect.unreachable());
  transport.send(REGISTER);
  const [first] = sources;
  first.push(JSON.stringify(SNAPSHOT));
  first.error(2);
  retry.bump();
  const [, second] = sources;
  second.open();
  const restarted: Sync.Message = { type: "snapshot", key: "counter", version: 0, value: 9 };
  second.push(JSON.stringify(restarted));
  expect(seen).toEqual([SNAPSHOT, restarted]);
  expect(states).toEqual(["connecting", "failed", "connecting", "live"]);
  expect(second.keys).toEqual(["counter"]);
  stopClose();
  transport.close();
});

test("browser reconnects deliver fresh snapshots through the same SSE source", () => {
  const { transport, sources } = createClient();
  const seen: Sync.Message[] = [];
  transport.onMessage((message) => seen.push(message));
  transport.send(REGISTER);
  const [first] = sources;
  first.open();
  first.push(JSON.stringify(SNAPSHOT));
  first.error(0);
  first.open();
  first.push(JSON.stringify(SNAPSHOT));
  expect(seen).toEqual([SNAPSHOT, SNAPSHOT]);
  expect(sources).toHaveLength(1);
  expect(first.closes).toBe(0);
  transport.close();
});

test("malformed SSE frames before the first snapshot fail and close the transport", () => {
  for (const frame of [
    7,
    "not json",
    "null",
    "3",
    JSON.stringify(REGISTER),
    JSON.stringify({ ...SNAPSHOT, key: 3 }),
    JSON.stringify({ ...SNAPSHOT, version: "3" }),
  ]) {
    const { transport, sources, states } = createClient();
    let closes = 0;
    transport.onClose(() => {
      closes += 1;
    });
    transport.onMessage(() => expect.unreachable());
    transport.send(REGISTER);
    const [first] = sources;
    first.push(frame);
    expect(states).toEqual(["connecting", "failed"]);
    expect(closes).toBe(1);
    transport.close();
  }
});

test("a malformed SSE frame after a snapshot fails the stream but keeps sync attached", () => {
  const { transport, sources, states } = createClient();
  const seen: Sync.Message[] = [];
  transport.onMessage((message) => seen.push(message));
  const stop = transport.onClose(() => expect.unreachable());
  transport.send(REGISTER);
  const [first] = sources;
  first.push(JSON.stringify(SNAPSHOT));
  first.push("not json");
  expect(states).toEqual(["connecting", "failed"]);
  expect(first.closes).toBe(1);
  expect(seen).toEqual([SNAPSHOT]);
  stop();
  transport.close();
});

test("closing the SSE client parts once and prevents later sends and retry intents", () => {
  const { transport, sources, states, retry } = createClient();
  const closed: string[] = [];
  transport.onClose(() => {
    closed.push("first");
    transport.close();
  });
  transport.onClose(() => closed.push("second"));
  transport.onMessage(() => expect.unreachable());
  transport.send(REGISTER);
  const [first] = sources;
  transport.close();
  transport.close();
  transport.send(REGISTER);
  retry.bump();
  first.open();
  first.error(0);
  first.push(JSON.stringify(SNAPSHOT));
  expect(closed).toEqual(["first", "second"]);
  expect(first.closes).toBe(1);
  expect(sources).toHaveLength(1);
  expect(states).toEqual(["connecting"]);
  expect(retry.stops).toBe(1);
});

test("an SSE client closed before opening tells late close listeners and opens nothing", () => {
  const transport = createSseClient({ open: () => expect.unreachable() });
  transport.close();
  let closes = 0;
  const stop = transport.onClose(() => {
    closes += 1;
  });
  stop();
  transport.send(REGISTER);
  transport.close();
  expect(closes).toBe(1);
});

test("an SSE client needs no state or retry hooks to receive snapshots", () => {
  const source = new FakeSource([]);
  const transport = createSseClient({ open: () => source });
  const seen: Sync.Message[] = [];
  transport.onMessage((message) => seen.push(message));
  transport.send(REGISTER);
  source.open();
  source.error(0);
  source.push(JSON.stringify(SNAPSHOT));
  source.error(2);
  expect(seen).toEqual([SNAPSHOT]);
  transport.close();
});

test("a source open failure reaches the SSE client caller unchanged", () => {
  const error = new Error("cannot open");
  const transport = createSseClient({
    open: () => {
      throw error;
    },
  });
  expect(() => transport.send(REGISTER)).toThrow(error);
  transport.close();
});
