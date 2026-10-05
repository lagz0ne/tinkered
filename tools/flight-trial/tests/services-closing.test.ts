import { once } from "node:events";
import { createConnection } from "node:net";
import { createScope } from "@tinker/core";
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
} from "../src/index.ts";

const services = [
  { name: "supplier", app: supplierApp, path: "/air/offer_requests" },
  { name: "payment", app: paymentApp, path: "/v1/payment_intents" },
];
const calls = z.object({ data: z.array(z.object({ route: z.string(), status: z.number() })) });

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
