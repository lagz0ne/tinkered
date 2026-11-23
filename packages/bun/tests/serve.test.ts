import { bytes, capsule, createScope, operation, rpc } from "@tinkered/core";
import type { RpcBody } from "@tinkered/core";
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

/** Reads the whole body and answers its length. */
const size = (r: Request) => r.arrayBuffer().then((b) => new Response(String(b.byteLength)));

/** POSTs a body: the reply's text when it is ok, else its status. */
const post = (at: URL, path: string, body: BodyInit, headers?: Record<string, string>) =>
  fetch(new URL(path, at), { method: "POST", body, headers, duplex: "half" } as RequestInit).then(
    (r) => (r.ok ? r.text() : String(r.status)),
  );

/** A body of `length` zero bytes in 64 KiB chunks: Bun sends it chunked, with no Content-Length. */
const chunked = (length: number) => {
  let left = length;
  return new ReadableStream<Uint8Array>({
    pull(out) {
      if (left <= 0) return out.close();
      out.enqueue(new Uint8Array(Math.min(65_536, left)));
      left -= 65_536;
    },
  });
};

const files = rpc({
  "file.size": {
    input: z.object({
      file: bytes(z.custom<RpcBody>(), { max: 16 << 20, types: ["application/octet-stream"] }),
    }),
    output: z.number(),
  },
});

const fileSize = operation({
  label: "file.size.here",
  input: files["file.size"].input,
  run: async (_, { input }) => (await input.file.bytes()).length,
});

/** A server whose socket handler has a 16 MiB bytes key, beside a handler with no maxBody. */
const besideBigKey = async () => {
  const socket = ws.server({ path: "/rpc", services: [files] });
  const plain = handler({ answer: size });
  const app = await createScope({
    capsules: [
      serve({ port: 0, websocket: socket, handlers: [plain] }),
      files({ implement: { "file.size": fileSize } }),
      socket,
      plain,
    ],
  }).ready;
  closers.push(() => app.close());
  return app.resolve(serve.url).get()!;
};

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

test("a handler takes a body up to its own maxBody, and gets 413 past it", async () => {
  const wide = capsule({
    label: "wide",
    hooks: {
      async start({ next }) {
        await next();
        return { fetch: size, maxBody: 4 << 20 };
      },
    },
  });
  /** Never asked: its 8 MiB only lifts Bun's server-wide limit past the 5 MiB sent. */
  const wider = capsule({
    label: "wider",
    hooks: {
      async start({ next }) {
        await next();
        return { fetch: () => undefined, maxBody: 8 << 20 };
      },
    },
  });
  const app = await createScope({
    capsules: [serve({ port: 0, handlers: [wide, wider] }), wide, wider],
  }).ready;
  closers.push(() => app.close());
  const at = app.resolve(serve.url).get()!;

  expect([
    await post(at, "/api/wide", new Uint8Array(3 << 20)),
    await post(at, "/api/wide", new Uint8Array(5 << 20)),
  ]).toEqual([String(3 << 20), "413"]);
});

test("a handler with no maxBody takes 1 MiB; past it, 413, even beside a 16 MiB bytes key", async () => {
  const at = await besideBigKey();

  expect([
    await post(at, "/api/plain", new Uint8Array(1 << 20)),
    await post(at, "/api/plain", new Uint8Array(2 << 20)),
  ]).toEqual([String(1 << 20), "413"]);
});

test("a chunked body with no Content-Length gets 413 once its count passes the cap", async () => {
  const at = await besideBigKey();

  expect(await post(at, "/api/plain", chunked(2 << 20))).toBe("413");
});

test("the bytes key still takes a body past 1 MiB, up to its own max", async () => {
  const at = await besideBigKey();
  const headers = { "x-input": "{}", "content-type": "application/octet-stream" };

  expect(await post(at, "/rpc/file.size", new Uint8Array(2 << 20), headers)).toBe(
    `{"ok":true,"value":${2 << 20}}`,
  );
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
