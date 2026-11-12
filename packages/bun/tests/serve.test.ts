import { capsule, createScope, operation, rpc } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { ws as wsClient } from "@/client";
import { serve, ws } from "@/index";

import { handler } from "./fixtures/handler";

// The listener is a capsule: one createScope serves the handlers; closing it closes the port.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

const api = rpc({ greet: { input: z.object({ name: z.string() }), output: z.string() } });

const greetHere = operation({
  label: "greet.here",
  input: api.greet.input,
  run: async (_, { input }) => `Hello, ${input.name}.`,
});

const text = (url: URL, path: string) => fetch(new URL(path, url)).then((r) => r.text());

test("a route handler and the socket handler answer on one port", async () => {
  const socket = ws.server({ path: "/rpc", services: [api] });
  const health = handler({
    answer: (r) => (new URL(r.url).pathname === "/api/health" ? new Response("ok") : undefined),
  });
  const app = await createScope({
    capsules: [
      serve({ port: 0, websocket: socket, handlers: [health] }),
      api({ implement: { greet: greetHere } }),
      socket,
      health,
    ],
  }).ready;
  closers.push(() => app.close());
  const at = app.resolve(serve.url).get()!;
  const tab = await createScope({
    capsules: [wsClient.client({ url: `ws://${at.host}/rpc` }), api({ remote: wsClient.client })],
  }).ready;
  closers.push(() => tab.close());

  expect(await text(at, "/api/health")).toBe("ok");
  expect(await tab.run(api.greet, { input: { name: "Ada" } })).toBe("Hello, Ada.");
});

test("handlers are asked in order; one that answers undefined passes the request on", async () => {
  const first = handler({
    answer: (r) => (r.url.endsWith("/api/a") ? new Response("a") : undefined),
  });
  // A second handler capsule: one scope holds one binding of a capsule today.
  const second = capsule({
    label: "second",
    hooks: {
      async start({ next }) {
        await next();
        return { fetch: () => new Response("b") };
      },
    },
  });
  const app = await createScope({
    capsules: [serve({ port: 0, handlers: [first, second] }), first, second],
  }).ready;
  closers.push(() => app.close());
  const at = app.resolve(serve.url).get()!;

  expect([await text(at, "/api/a"), await text(at, "/api/x")]).toEqual(["a", "b"]);
});

test("no handler answers: 404; a path no handler takes gets the page", async () => {
  const none = handler({ answer: () => undefined });
  const pages = { "/*": new Response("page") };
  const app = await createScope({
    capsules: [serve({ port: 0, pages, handlers: [none] }), none],
  }).ready;
  closers.push(() => app.close());
  const at = app.resolve(serve.url).get()!;

  expect((await fetch(new URL("/api/x", at))).status).toBe(404);
  expect(await text(at, "/a/b")).toBe("page");
});

test("close stops the port, then the handlers close", async () => {
  const seen: string[] = [];
  const cmd = handler({ answer: () => new Response("cmd"), closing: () => seen.push("handler") });
  const app = await createScope({
    capsules: [serve({ port: 0, handlers: [cmd] }), cmd],
  }).ready;
  const at = app.resolve(serve.url).get()!;

  await app.close();
  const after = await fetch(new URL("/api/x", at)).then(
    () => "answered",
    () => "refused",
  );

  expect([after, seen]).toEqual(["refused", ["handler"]]);
});

test("it prints where it listens on the stdout it is given", async () => {
  const lines: string[] = [];
  const cmd = handler({ answer: () => undefined });
  const app = await createScope({
    capsules: [serve({ port: 0, handlers: [cmd], stdout: { write: (l) => lines.push(l) } }), cmd],
  }).ready;
  closers.push(() => app.close());

  expect(lines).toEqual([`tinker: listening on ${app.resolve(serve.url).get()}\n`]);
});

test("a scope stopped during start never listens (ADR 0134)", async () => {
  const stop = new AbortController();
  const lines: string[] = [];
  const slow = capsule({
    label: "slow",
    hooks: {
      async start({ next }) {
        stop.abort(new Error("stop"));
        await next();
        return { fetch: () => new Response("slow") };
      },
    },
  });
  const app = createScope({
    signal: stop.signal,
    capsules: [serve({ port: 0, handlers: [slow], stdout: { write: (l) => lines.push(l) } }), slow],
  });

  await expect(app.ready).rejects.toBe(stop.signal.reason);
  expect((await app.closed).status).toBe("cancelled");
  expect(lines).toEqual([]);
});

test("serve declares its keys, its defaults, and the units it loads", async () => {
  const { port, pages, websocket, handlers, paths, development, stdout } = serve.config;
  const app = await createScope({ capsules: [serve({ port: 0 })] }).ready;
  closers.push(() => app.close());

  expect({
    labels: [port.target, pages, websocket, handlers, paths, development, stdout].map(
      (unit) => unit.label,
    ),
    record: app.capsules[0],
  }).toMatchObject({
    labels: [
      "serve.port",
      "serve.pages",
      "serve.websocket",
      "serve.handlers",
      "serve.paths",
      "serve.development",
      "serve.stdout",
    ],
    record: {
      label: "serve",
      config: {
        port: 0,
        pages: {},
        websocket: null,
        handlers: [],
        paths: [],
        development: false,
        stdout: null,
      },
      exports: ["url"],
      loaded: [
        { unit: "serve:session", role: "handler", explain: "The handlers answer in this session" },
        { unit: "serve.live", role: "state", explain: "The listening server" },
        { unit: "serve.url", role: "state", explain: "The listening server" },
      ],
    },
  });
});

test("a socket handler must go in `websocket`, not `handlers`: Bun takes one per server", async () => {
  const socket = ws.server({ path: "/rpc", services: [api] });
  const plain = handler({ answer: () => undefined });
  const app = createScope({
    capsules: [
      serve({ port: 0, handlers: [plain, socket] }),
      api({ implement: { greet: greetHere } }),
      socket,
      plain,
    ],
  });

  await expect(app.ready).rejects.toMatchObject({
    kind: "MissingConfig",
    payload: { label: "serve", key: "websocket" },
  });
});

test("the largest maxBody of the handlers sets the body limit; 1 MiB at least", async () => {
  const size = (r: Request) => r.arrayBuffer().then((b) => new Response(String(b.byteLength)));
  const big = capsule({
    label: "big",
    hooks: {
      async start({ next }) {
        await next();
        return { fetch: (r: Request) => (r.url.endsWith("/api/big") ? size(r) : undefined) };
      },
    },
  });
  const small = handler({ answer: size });
  const post = (at: URL, path: string, bytes: number) =>
    fetch(new URL(path, at), { method: "POST", body: new Uint8Array(bytes) }).then((r) =>
      r.ok ? r.text() : String(r.status),
    );
  const app = await createScope({
    capsules: [serve({ port: 0, handlers: [big, small] }), big, small],
  }).ready;
  const wide = capsule({
    label: "wide",
    hooks: {
      async start({ next }) {
        await next();
        return { fetch: size, maxBody: 4_194_304 };
      },
    },
  });
  const app2 = await createScope({ capsules: [serve({ port: 0, handlers: [wide] }), wide] }).ready;
  closers.push(
    () => app.close(),
    () => app2.close(),
  );
  const at = app.resolve(serve.url).get()!;
  const at2 = app2.resolve(serve.url).get()!;

  expect([
    await post(at, "/api/small", 1_000_000),
    await post(at2, "/api/wide", 2_097_152),
  ]).toEqual(["1000000", "2097152"]);
});

test("`development` turns on Bun's development mode", async () => {
  const mode = handler({ answer: (_r, _s, server) => new Response(String(server.development)) });
  const dev = await createScope({
    capsules: [serve({ port: 0, handlers: [mode], development: true }), mode],
  }).ready;
  closers.push(() => dev.close());
  const prod = await createScope({ capsules: [serve({ port: 0, handlers: [mode] }), mode] }).ready;
  closers.push(() => prod.close());

  expect([
    await text(dev.resolve(serve.url).get()!, "/api/x"),
    await text(prod.resolve(serve.url).get()!, "/api/x"),
  ]).toEqual(["true", "false"]);
});
