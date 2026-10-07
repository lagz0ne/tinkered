import { once } from "node:events";
import { createConnection } from "node:net";
import { createScope, extension, type Scope } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  supplierApp,
  paymentApp,
  supplierId,
  port,
  host,
  controlToken,
  stopSignal,
  webhookUrl,
  webhookSecret,
} from "../src/index";
import { web } from "../services/http";

const services = [
  { name: "supplier", app: supplierApp, path: "/air/offer_requests" },
  { name: "payment", app: paymentApp, path: "/v1/payment_intents" },
];
const calls = z.object({ data: z.array(z.object({ route: z.string(), status: z.number() })) });

function createGate<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function captureAppSession(resolve: (scope: Scope.Handle) => void) {
  return extension({
    label: "capture app session",
    hooks: {
      session(event) {
        resolve(event.handle);
        return event.next();
      },
    },
  });
}

test.each(services)(
  "releasing $name web closes the port and lets graceful close settle",
  async ({ app }) => {
    const stop = new AbortController();
    const created = createGate<Scope.Handle>();
    const capture = captureAppSession(created.resolve);
    const scope = createScope({
      signal: stop.signal,
      extensions: [capture, app],
      tags: [
        supplierId("supplier-a"),
        port(0),
        host("127.0.0.1"),
        controlToken("grader"),
        stopSignal(stop.signal),
        webhookUrl("http://127.0.0.1:1"),
        webhookSecret("closing-test"),
      ],
    });
    await scope.ready;
    const { url } = scope.resolve(app);
    const session = await created.promise;
    const target = new URL(url);
    let socket: ReturnType<typeof createConnection> | undefined;
    try {
      session.release(web);
      socket = createConnection({ host: target.hostname, port: Number(target.port) });
      await expect(once(socket, "connect")).rejects.toMatchObject({ code: "ECONNREFUSED" });
      let closed = false;
      const closing = scope.close({ graceful: true }).then((result) => {
        closed = true;
        return result;
      });
      await expect.poll(() => closed).toBe(true);
      expect(await closing).toMatchObject({ status: "success" });
      expect(stop.signal.aborted).toBe(false);
    } finally {
      socket?.destroy();
      stop.abort();
      await scope.closed;
    }
  },
);

test.each(services)(
  "a graceful $name close refuses new connections while a running reply drains",
  async ({ app }) => {
    const stop = new AbortController();
    const created = createGate<Scope.Handle>();
    const started = createGate<void>();
    const resume = createGate<void>();
    const capture = captureAppSession(created.resolve);
    const scope = createScope({
      signal: stop.signal,
      extensions: [capture, app],
      tags: [
        supplierId("supplier-a"),
        port(0),
        host("127.0.0.1"),
        controlToken("grader"),
        stopSignal(stop.signal),
        webhookUrl("http://127.0.0.1:1"),
        webhookSecret("closing-test"),
      ],
    });
    await scope.ready;
    const { url } = scope.resolve(app);
    const session = await created.promise;
    session.resolve(web).get("/held", async () => {
      const body = await session.run({
        label: "held HTTP reply",
        async run() {
          started.resolve();
          await resume.promise;
          return "ok";
        },
      });
      return new Response(body);
    });
    const reply = fetch(`${url}/held`).then(async (response) => ({
      status: response.status,
      body: await response.text(),
    }));
    const target = new URL(url);
    let socket: ReturnType<typeof createConnection> | undefined;
    try {
      await started.promise;
      let closed = false;
      const closing = scope.close({ graceful: true }).then((result) => {
        closed = true;
        return result;
      });
      socket = createConnection({ host: target.hostname, port: Number(target.port) });
      await expect(once(socket, "connect")).rejects.toMatchObject({ code: "ECONNREFUSED" });
      expect(closed).toBe(false);
      resume.resolve();
      expect(await reply).toEqual({ status: 200, body: "ok" });
      await expect.poll(() => closed).toBe(true);
      expect(await closing).toMatchObject({ status: "success" });
      expect(stop.signal.aborted).toBe(false);
    } finally {
      socket?.destroy();
      resume.resolve();
      stop.abort();
      await reply;
      await scope.closed;
    }
  },
);

async function post(url: string, path: string, body: unknown) {
  const reply = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer grader" },
    body: JSON.stringify(body),
  });
  return { status: reply.status, body: await reply.json() };
}

test.each(services)(
  "a graceful $name close ends an incomplete request body and closes the port",
  async ({ app, path }) => {
    const stop = new AbortController();
    const scope = createScope({
      signal: stop.signal,
      extensions: app,
      tags: [
        supplierId("supplier-a"),
        port(0),
        host("127.0.0.1"),
        controlToken("grader"),
        stopSignal(stop.signal),
        webhookUrl("http://127.0.0.1:1"),
        webhookSecret("closing-test"),
      ],
    });
    await scope.ready;
    const { url } = scope.resolve(app);
    const target = new URL(url);
    const socket = createConnection({ host: target.hostname, port: Number(target.port) });
    const disconnected = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    try {
      await once(socket, "connect");
      socket.write(`POST ${path} HTTP/1.1\r\nHost: ${target.host}\r\nContent-Length: 100\r\n\r\n{`);
      await expect
        .poll(async () => {
          const log = calls.parse(
            await (
              await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
            ).json(),
          );
          return log.data.some((call) => call.route === `POST ${path}` && call.status === 0);
        })
        .toBe(true);
      let closed = false;
      const closing = scope.close({ graceful: true }).then((result) => {
        closed = true;
        return result;
      });
      await expect.poll(() => closed).toBe(true);
      expect(await closing).toMatchObject({ status: "success" });
      await disconnected;
      expect(stop.signal.aborted).toBe(false);
      await expect(fetch(`${url}${path}`)).rejects.toBeDefined();
    } finally {
      socket.destroy();
      stop.abort();
      await scope.closed;
    }
  },
);

test.each(services)(
  "a graceful $name close ends a delayed route without advancing the clock",
  async ({ app, path }) => {
    const stop = new AbortController();
    const scope = createScope({
      signal: stop.signal,
      extensions: app,
      tags: [
        supplierId("supplier-a"),
        port(0),
        host("127.0.0.1"),
        controlToken("grader"),
        stopSignal(stop.signal),
        webhookUrl("http://127.0.0.1:1"),
        webhookSecret("closing-test"),
      ],
    });
    await scope.ready;
    const { url } = scope.resolve(app);
    await post(url, "/control/clock", { now: 10000 });
    await post(url, "/control/routes", { route: `POST ${path}`, delayMs: 100 });
    const pending = post(url, path, {});
    try {
      await expect
        .poll(async () => {
          const log = calls.parse(
            await (
              await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
            ).json(),
          );
          return log.data.some((call) => call.route === `POST ${path}` && call.status === 0);
        })
        .toBe(true);
      let closed = false;
      const closing = scope.close({ graceful: true }).then((result) => {
        closed = true;
        return result;
      });
      await expect.poll(() => closed).toBe(true);
      expect(await closing).toMatchObject({ status: "success" });
      expect((await pending).status).toBe(503);
      expect(stop.signal.aborted).toBe(false);
    } finally {
      stop.abort();
      await pending;
      await scope.closed;
    }
  },
);
