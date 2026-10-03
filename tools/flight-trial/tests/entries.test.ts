import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { createScope, resource, tag } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { z } from "zod";

const service = tag<"supplier" | "payment">({ label: "test entry service" });
const settings = tag<NodeJS.ProcessEnv>({ label: "test entry settings" });
const token = "entry-control-token";
const childEntry = resource({
  label: "real service process",
  depends: { service, settings },
  async factory({ service, settings }, ctx) {
    const child = spawn(
      process.execPath,
      [new URL(`../services/${service}/main.ts`, import.meta.url).pathname, "supplier-a"],
      { env: { ...process.env, ...settings, PORT: "0" }, stdio: ["ignore", "pipe", "inherit"] },
    );
    const ended = once(child, "exit").then(([code, signal]) =>
      z
        .object({ code: z.number().nullable(), signal: z.string().nullable() })
        .parse({ code, signal }),
    );
    ctx.defer(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await ended;
    });
    let output = "";
    for await (const chunk of child.stdout) {
      output += String(chunk);
      if (output.includes("\n")) break;
    }
    const ready = z
      .object({ service: z.string(), url: z.url(), pid: z.number().int().positive() })
      .parse(JSON.parse(output.trim()));
    expect(ready.service).toBe(service === "supplier" ? "supplier-a" : "payment");
    expect(ready.pid).not.toBe(process.pid);
    return {
      url: ready.url,
      ended,
      terminate() {
        child.kill("SIGTERM");
      },
    };
  },
});

/** Stryker cannot collect a child's coverage; this runs the same entry against real HTTP. */
const processEntry = resource({
  label: "service entry in this process",
  depends: { service, settings },
  async factory({ service, settings }, ctx) {
    const probe = createServer();
    ctx.defer(async () => {
      if (probe.listening) await new Promise<void>((resolve) => probe.close(() => resolve()));
    });
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const address = probe.address();
    if (address === null || typeof address === "string") expect.fail("TCP port required");
    const port = address.port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const { supplierMain, paymentMain } = await import("../src/index.ts");
    const env = { ...settings, PORT: String(port) };
    const ended = (
      service === "supplier" ? supplierMain(env, "supplier-a") : paymentMain(env)
    ).then(
      (code) => ({ code, signal: null }),
      (error: unknown) => ({ error }),
    );
    ctx.defer(async () => {
      process.emit("SIGINT");
      const result = await ended;
      if ("error" in result) throw result.error;
    });
    return {
      url: `http://127.0.0.1:${port}`,
      ended,
      terminate() {
        process.emit("SIGTERM");
      },
    };
  },
});

const inbox = resource({
  label: "entry webhook receiver",
  async factory(_deps, ctx) {
    const events: { body: string; signature: string }[] = [];
    const server = createServer(async (request, response) => {
      if (request.method === "GET") {
        response.end(JSON.stringify({ data: events }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      events.push({
        body: Buffer.concat(chunks).toString("utf8"),
        signature: z.string().parse(request.headers["stripe-signature"]),
      });
      response.end("ok");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    ctx.defer(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const address = server.address();
    if (address === null || typeof address === "string") expect.fail("TCP port required");
    return { url: `http://127.0.0.1:${address.port}` };
  },
});

async function post(url: string, path: string, body: unknown) {
  return fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

test("the supplier entry serves its settings and closes cleanly on SIGTERM", async () => {
  for (const mode of ["child", "process"]) {
    const stop = new AbortController();
    const scope = createScope({
      signal: stop.signal,
      tags: [
        service("supplier"),
        settings({ HOST: "127.0.0.1", CONTROL_TOKEN: token, HOLD_MS: "7311" }),
      ],
    });
    try {
      const app =
        mode === "child" ? await scope.resolve(childEntry) : await scope.resolve(processEntry);
      await expect
        .poll(async () =>
          fetch(`${app.url}/control/calls`, {
            headers: { authorization: `Bearer ${token}` },
          }).then(
            (response) => response.status,
            () => 0,
          ),
        )
        .toBe(200);
      expect((await post(app.url, "/control/clock", { now: 10000 })).status).toBe(200);
      const search = await post(app.url, "/air/offer_requests", {
        data: { slices: [{ origin: "LHR", destination: "AMS", departure_date: "2027-01-15" }] },
      });
      expect(search.status).toBe(201);
      const offers = z
        .object({ data: z.object({ offers: z.array(z.object({ id: z.string() })).min(1) }) })
        .parse(await search.json()).data.offers;
      const held = await post(app.url, "/air/orders", {
        data: { selected_offers: [offers.at(0)!.id], type: "hold" },
      });
      expect(held.status).toBe(201);
      expect(await held.json()).toMatchObject({
        data: {
          payment_status: {
            awaiting_payment: true,
            payment_required_by: "1970-01-01T00:00:17.311Z",
          },
        },
      });
      app.terminate();
      await expect
        .poll(() =>
          fetch(`${app.url}/control/calls`).then(
            () => true,
            () => false,
          ),
        )
        .toBe(false);
      const ended = await app.ended;
      if ("error" in ended) throw ended.error;
      expect(ended).toEqual({ code: 0, signal: null });
    } finally {
      stop.abort();
      await scope.closed;
    }
  }
});

test("the payment entry serves its settings and closes cleanly on SIGTERM", async () => {
  const stopInbox = new AbortController();
  const inboxScope = createScope({ signal: stopInbox.signal });
  try {
    const receiver = await inboxScope.resolve(inbox);
    for (const mode of ["child", "process"]) {
      const stop = new AbortController();
      const scope = createScope({
        signal: stop.signal,
        tags: [
          service("payment"),
          settings({
            HOST: "127.0.0.1",
            CONTROL_TOKEN: token,
            WEBHOOK_URL: `${receiver.url}/webhooks/stripe`,
            WEBHOOK_SECRET: "entry-signing-secret",
            WEBHOOK_DELAY_MS: "17",
          }),
        ],
      });
      try {
        const app =
          mode === "child" ? await scope.resolve(childEntry) : await scope.resolve(processEntry);
        await expect
          .poll(() =>
            fetch(`${app.url}/control/calls`, {
              headers: { authorization: `Bearer ${token}` },
            }).then(
              (response) => response.status,
              () => 0,
            ),
          )
          .toBe(200);
        expect((await post(app.url, "/control/clock", { now: 10000 })).status).toBe(200);
        const created = await post(app.url, "/v1/payment_intents", {
          amount: 789,
          currency: "usd",
        });
        expect(created.status).toBe(200);
        const intent = z.object({ id: z.string() }).parse(await created.json());
        expect((await post(app.url, `/v1/payment_intents/${intent.id}/confirm`, {})).status).toBe(
          200,
        );
        expect((await post(app.url, "/control/clock", { advanceMs: 17 })).status).toBe(200);
        await expect
          .poll(async () => {
            const response = z
              .object({ data: z.array(z.object({ body: z.string(), signature: z.string() })) })
              .parse(await (await fetch(`${receiver.url}/control/calls`)).json());
            return response.data.filter(
              (event) => JSON.parse(event.body).data.object.id === intent.id,
            );
          })
          .toMatchObject([{ body: expect.any(String), signature: expect.any(String) }]);
        const events = z
          .object({ data: z.array(z.object({ body: z.string(), signature: z.string() })) })
          .parse(await (await fetch(`${receiver.url}/control/calls`)).json());
        const event = events.data.find(
          (event) => JSON.parse(event.body).data.object.id === intent.id,
        )!;
        const timestamp = event.signature.split(",").at(0)!.slice(2);
        const hash = createHmac("sha256", "entry-signing-secret")
          .update(`${timestamp}.${event.body}`)
          .digest("hex");
        expect(event.signature).toBe(`t=${timestamp},v1=${hash}`);
        app.terminate();
        await expect
          .poll(() =>
            fetch(`${app.url}/control/calls`).then(
              () => true,
              () => false,
            ),
          )
          .toBe(false);
        const ended = await app.ended;
        if ("error" in ended) throw ended.error;
        expect(ended).toEqual({ code: 0, signal: null });
      } finally {
        stop.abort();
        await scope.closed;
      }
    }
  } finally {
    stopInbox.abort();
    await inboxScope.closed;
  }
});
