import { channel, createScope, operation, rpc } from "@tinker/core";
import type { Observe } from "@tinker/core";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { ws as wsServer } from "@/index";

// The server's side of the frame protocol, read off a raw socket: what each message answers,
// which frames close the socket, and the guards on the upgrade.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const api = rpc({
  greet: { input: z.object({ name: z.string() }), output: z.object({ text: z.string() }) },
  forever: { mode: "stream", input: z.null(), output: z.number() },
  done: { mode: "stream", input: z.null(), output: z.number() },
});

const greet = operation({
  label: "greet.here",
  input: api.greet.input,
  run: (_, { input }) => ({ text: input.name }),
});

const forever = operation({
  label: "forever.here",
  input: z.null(),
  depends: { out: channel.required },
  run: async ({ out }) => {
    out.send(1);
    await new Promise((r) => out.closed.addEventListener("abort", r));
  },
});

const done = operation({ label: "done.here", input: z.null(), run: () => {} });

type Door = {
  upgrade: (r: Request, s: unknown, b: unknown) => Response | null | undefined;
  post: (r: Request, s: unknown) => Promise<Response | undefined>;
  websocket: Record<string, unknown>;
  maxBody: number;
};

/** A scope with the server on a real port; `spans` and `logs` are what it observed. */
async function boot(options: Record<string, unknown> = {}) {
  const spans: string[] = [];
  const logs: Observe.Log[] = [];
  const transport = wsServer.server({ path: "/rpc", services: [api as never], ...options });
  const scope = await createScope({
    observe: { export: (s) => void spans.push(s.name), log: (l) => void logs.push(l) },
    capsules: [api({ implement: { greet, forever, done } }), transport],
  }).ready;

  const door = scope.resolve(transport) as never as Door;
  const bun = Bun.serve({
    port: 0,
    idleTimeout: 0,
    websocket: door.websocket as never,
    fetch: (r, b) => {
      const reply = door.upgrade(r, scope, b);
      return reply === null ? undefined : (reply ?? new Response("other", { status: 404 }));
    },
  });
  closers.push(() => bun.stop(true));
  closers.push(() => scope.close());

  const http = `http://localhost:${bun.port}`;
  return { scope, door, spans, logs, http, url: `ws://localhost:${bun.port}/rpc` };
}

/** A raw socket: `got` holds each message the server sent, frame by frame. */
async function socketTo(url: string) {
  const socket = new WebSocket(url);
  const frames: unknown[][] = [];
  socket.onmessage = (e) => void frames.push(JSON.parse(String(e.data)));
  const closed = new Promise<[number, string]>(
    (r) => (socket.onclose = (e) => r([e.code, e.reason])),
  );
  await new Promise((r) => (socket.onopen = r));
  closers.push(() => socket.close());

  const got = () => frames.flat() as Array<Record<string, unknown>>;
  const until = async (ok: () => boolean) => {
    for (let n = 0; !ok(); n++) {
      if (n > 200) throw new Error("timed out");
      await tick(10);
    }
  };
  return { socket, frames, got, until, closed };
}

/** The error a sync call throws (createScope throws a config error at once), or null. */
const caught = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (error) {
    return error;
  }
};

const byId = (all: Array<Record<string, unknown>>) =>
  [...all].sort((a, b) => Number(a.i) - Number(b.i));

test("each message gets its answer by id: a reply, 404, or 400 with no address or text", async () => {
  const { url, spans } = await boot();
  const s = await socketTo(url);

  s.socket.send(
    JSON.stringify([
      { i: 1, a: "greet", t: JSON.stringify({ name: "a" }) },
      { i: 2, a: "nope", t: "null" },
      { i: 3, t: "null" },
      { i: 4, a: "greet" },
    ]),
  );
  await s.until(() => s.got().length === 4);

  expect(byId(s.got())).toEqual([
    { i: 1, t: JSON.stringify({ ok: true, value: { text: "a" } }) },
    { i: 2, e: 404 },
    { i: 3, e: 400 },
    { i: 4, e: 400 },
  ]);
  expect(spans).toContain("ws.serve");
});

test("a watch: pushes, then a stop ends it; a key that ends by itself ends the watch", async () => {
  const { url, spans } = await boot();
  const s = await socketTo(url);

  s.socket.send(JSON.stringify([{ i: 1, a: "forever", t: "null", w: 1 }]));
  await s.until(() => s.got().length === 1);
  expect(s.got()[0]).toEqual({ i: 1, t: JSON.stringify({ ok: true, value: 1 }) });

  s.socket.send(JSON.stringify([{ i: 1, x: 1 }]));
  await s.until(() => s.got().length === 2);
  expect(s.got()[1]).toEqual({ i: 1, end: 1 });

  s.socket.send(JSON.stringify([{ i: 2, a: "done", t: "null", w: 1 }]));
  await s.until(() => s.got().length === 3);
  expect(s.got()[2]).toEqual({ i: 2, end: 1 });
  expect(spans).toContain("ws.serveStream");
});

test("a watch on a reply key or an unknown address answers 404", async () => {
  const { url } = await boot();
  const s = await socketTo(url);

  s.socket.send(
    JSON.stringify([
      { i: 1, a: "greet", t: JSON.stringify({ name: "a" }), w: 1 },
      { i: 2, a: "nope", t: "null", w: 1 },
    ]),
  );
  await s.until(
    () => s.got().some((m) => m.i === 1) && s.got().some((m) => m.e !== undefined && m.i === 2),
  );

  expect(s.got().filter((m) => m.e !== undefined)).toEqual(
    expect.arrayContaining([
      { i: 1, e: 404 },
      { i: 2, e: 404 },
    ]),
  );
});

test("past maxWatches a watch answers 429; a call still runs, and a freed slot is free", async () => {
  const { url } = await boot({ maxWatches: 1 });
  const s = await socketTo(url);

  s.socket.send(JSON.stringify([{ i: 1, a: "forever", t: "null", w: 1 }]));
  await s.until(() => s.got().length === 1);
  s.socket.send(
    JSON.stringify([
      { i: 2, a: "forever", t: "null", w: 1 },
      { i: 3, a: "greet", t: JSON.stringify({ name: "b" }) },
    ]),
  );
  await s.until(() => s.got().length === 3);
  expect(byId(s.got().slice(1))).toEqual([
    { i: 2, e: 429 },
    { i: 3, t: JSON.stringify({ ok: true, value: { text: "b" } }) },
  ]);

  s.socket.send(JSON.stringify([{ i: 1, x: 1 }]));
  await s.until(() => s.got().length === 4);
  s.socket.send(JSON.stringify([{ i: 4, a: "forever", t: "null", w: 1 }]));
  await s.until(() => s.got().length === 5);
  expect(s.got()[4]).toEqual({ i: 4, t: JSON.stringify({ ok: true, value: 1 }) });
});

test("a stop for an id with no watch does nothing", async () => {
  const { url } = await boot();
  const s = await socketTo(url);

  s.socket.send(
    JSON.stringify([
      { i: 9, x: 1 },
      { i: 1, a: "greet", t: '{"name":"c"}' },
    ]),
  );
  await s.until(() => s.got().length === 1);
  await tick();

  expect(s.got()).toEqual([{ i: 1, t: JSON.stringify({ ok: true, value: { text: "c" } }) }]);
});

test("a frame that is binary, not JSON, not an array, or has an id that is not whole closes 1008", async () => {
  const { url } = await boot();
  const frames: Array<string | Uint8Array<ArrayBuffer>> = [
    new Uint8Array([91, 93]),
    "not json",
    JSON.stringify({ i: 1 }),
    JSON.stringify([{ i: 1.5, a: "greet", t: "{}" }]),
    JSON.stringify([null]),
  ];

  for (const frame of frames) {
    const s = await socketTo(url);
    s.socket.send(frame);
    expect(await s.closed).toEqual([1008, "bad frame"]);
  }
});

test("a frame of 32 messages fits", async () => {
  const { url } = await boot();
  const s = await socketTo(url);

  s.socket.send(
    JSON.stringify(Array.from({ length: 32 }, (_, i) => ({ i, a: "greet", t: '{"name":"n"}' }))),
  );
  await s.until(() => s.got().length === 32);
  expect(s.frames).toHaveLength(1);
});

test("a message after the scope closed answers 503", async () => {
  const { url, scope } = await boot();
  const s = await socketTo(url);
  await scope.close();

  s.socket.send(JSON.stringify([{ i: 1, a: "greet", t: '{"name":"a"}' }]));
  await s.until(() => s.got().length === 1);
  expect(s.got()).toEqual([{ i: 1, e: 503 }]);
});

test("a codec that throws: a call logs ws message failed, a watch logs ws stream failed and ends", async () => {
  const codec = {
    serialize: () => {
      throw new Error("no write");
    },
    deserialize: () => {
      throw new Error("no read");
    },
  };
  const { url, logs } = await boot({ codec });
  const s = await socketTo(url);

  s.socket.send(
    JSON.stringify([
      { i: 1, a: "forever", t: "x", w: 1 },
      { i: 2, a: "greet", t: "x" },
    ]),
  );
  await s.until(() => s.got().length === 1);
  await tick();

  expect(s.got()).toEqual([{ i: 1, end: 1 }]);
  const lines = logs.map((l) => [l.message, l.attributes]);
  expect(lines).toContainEqual([
    "ws stream failed",
    { address: "forever", capsule: "ws.server", cause: "Error: no write" },
  ]);
  expect(lines).toContainEqual([
    "ws message failed",
    { capsule: "ws.server", error: "Error: no write" },
  ]);
});

test("the upgrade: another path is not this server's; a plain GET answers 426", async () => {
  const { http } = await boot();

  expect((await fetch(`${http}/other`)).status).toBe(404);
  expect(await (await fetch(`${http}/other`)).text()).toBe("other");
  expect((await fetch(`${http}/rpc`)).status).toBe(426);
  expect((await fetch(`${http}/rpc/greet`)).status).toBe(404);
});

test("a set origin is the one let in: the server's own is refused, none is let in", async () => {
  const { http } = await boot({ origin: "https://app.example/any/path" });
  const at = (origin?: string) =>
    fetch(`${http}/rpc`, { headers: origin === undefined ? {} : { origin } }).then((r) => r.status);

  expect(await at("https://app.example")).toBe(426);
  expect(await at(http)).toBe(403);
  expect(await at()).toBe(426);
});

test("an origin that is not http(s), or no URL, stops the start: MissingConfig origin", async () => {
  for (const origin of ["ftp://files.example", "not a url"]) {
    const start = createScope({
      capsules: [wsServer.server({ path: "/rpc", services: [], origin })],
    }).ready;
    await expect(start).rejects.toMatchObject({
      kind: "MissingConfig",
      payload: { label: "ws.server", key: "origin" },
    });
  }
});

test("no path stops the start: MissingConfig path", () => {
  expect(
    caught(() => createScope({ capsules: [wsServer.server({ services: [] } as never)] })),
  ).toMatchObject({
    kind: "MissingConfig",
    payload: { label: "ws.server", key: "path" },
  });
});

test("maxPayload must be a positive whole number of bytes", () => {
  for (const maxPayload of [0, -1, 1.5, "8"]) {
    const error = caught(() =>
      createScope({
        capsules: [wsServer.server({ path: "/rpc", services: [], maxPayload } as never)],
      }),
    );
    expect(error).toMatchObject({
      kind: "DataValidationFailed",
      payload: { label: "ws.maxPayload" },
    });
    expect(String(Object(error).payload.cause)).toBe(
      "TypeError: not a positive whole number of bytes",
    );
  }
});

test("the socket's settings: 1 MiB both ways, closed on backpressure, 60 s idle with pings", async () => {
  const { door } = await boot();

  expect(door.websocket).toMatchObject({
    maxPayloadLength: 1_048_576,
    backpressureLimit: 1_048_576,
    closeOnBackpressureLimit: true,
    idleTimeout: 60,
    sendPings: true,
  });
  expect(door.maxBody).toBe(0);
});

test("maxPayload sets both limits", async () => {
  const { door } = await boot({ maxPayload: 4096 });

  expect(door.websocket).toMatchObject({ maxPayloadLength: 4096, backpressureLimit: 4096 });
});

test("post: not a POST, or not under the path, is not this server's", async () => {
  const { door, scope, http } = await boot();

  expect(await door.post(new Request(`${http}/rpc/greet`), scope)).toBeUndefined();
  expect(await door.post(new Request(`${http}/rpcx/greet`, { method: "POST" }), scope)).toBe(
    undefined,
  );
  expect(await door.post(new Request(`${http}/rpc`, { method: "POST" }), scope)).toBeUndefined();
  const reply = await door.post(new Request(`${http}/rpc/greet`, { method: "POST" }), scope);
  expect(reply?.status).toBe(404);
});
