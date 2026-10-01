import { getEventListeners } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vite-plus/test";
import { connect } from "@nats-io/transport-node";
import { runDev } from "@tinker/stack/dev";
import { isError } from "../src/index.ts";
import { createDevFixture } from "./dev-fixtures.ts";

test("dev serves the app and Vite client from one listener", async () => {
  const host = await createDevFixture(false);
  expect(await host.ready).toEqual({ kind: "ready", url: host.url });
  expect(host.probe.connections.at(0)).toBeUndefined();
  expect(
    await (await fetch(`${host.url}/api/value`, { headers: { accept: "text/html" } })).json(),
  ).toBe("first");
  const page = await fetch(host.url);
  expect(page.headers.get("content-type")).toBe("text/html");
  expect(await page.text()).toContain("/@vite/client");
  expect(await (await fetch(`${host.url}/client.ts`)).text()).toContain(
    'export const label = "client code"',
  );
  expect((await fetch(`${host.url}/missing`)).status).toBe(404);
  expect((await fetch(host.url, { method: "POST" })).status).toBe(404);
});

test("a client edit reaches HMR on the kept port and leaves the root running", async () => {
  const host = await createDevFixture(false);
  expect((await host.ready).kind).toBe("ready");
  await fetch(`${host.url}/client.ts`);
  const socket = new WebSocket(host.url.replace("http:", "ws:"), "vite-hmr");
  onTestFinished(() => socket.close());
  const connected = Promise.withResolvers<void>();
  const updated = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "connected") connected.resolve();
    if (message.type === "full-reload") updated.resolve();
  });
  socket.addEventListener("close", () => closed.resolve());
  await connected.promise;
  await writeFile(join(host.directory, "client.ts"), 'export const label: string = "edited";\n');
  await updated.promise;
  expect(host.probe.signals).toHaveLength(1);
  expect(host.probe.signals.at(0)!.aborted).toBe(false);
  host.stop.abort();
  expect(await host.done).toBe(0);
  await closed.promise;
});

test("three server edits close old roots and keep the same database and NATS handles", async () => {
  const host = await createDevFixture();
  expect(await host.ready).toEqual({ kind: "ready", url: host.url });
  const client = host.probe.clients.at(0)!;
  const connection = host.probe.connections.at(0)!;
  const server = connection.getServer();
  await client.exec("insert into kept values ('saved')");
  for (const value of ["second", "third", "fourth"]) {
    const oldClosed = host.probe.closed.at(-1)!;
    const count = host.probe.closed.length;
    await writeFile(
      join(host.directory, "shared/value.ts"),
      `export const value: string = ${JSON.stringify(value)};\n`,
    );
    await expect
      .poll(async () => (await fetch(`${host.url}/api/value`)).text(), { timeout: 20000 })
      .toBe(JSON.stringify(value));
    expect((await oldClosed).status).toBe("success");
    expect(host.probe.clients.at(-1)).toBe(client);
    expect(host.probe.connections.at(-1)).toBe(connection);
    expect(host.probe.cleaned).toBe(count);
    expect(host.probe.timers.size).toBe(1);
    expect(getEventListeners(host.probe.signals.at(-2)!, "abort")).toEqual([]);
    const deliveries = host.probe.deliveries;
    connection.publish("dev.changed");
    await connection.flush();
    await expect.poll(() => host.probe.deliveries).toBe(deliveries + 1);
  }
  expect(new Set(host.probe.clients).size).toBe(1);
  expect(new Set(host.probe.connections).size).toBe(1);
  expect((await client.query("select * from kept")).rows).toEqual([{ title: "saved" }]);
  host.stop.abort();
  expect(await host.done).toBe(0);
  expect(client.closed).toBe(true);
  expect(connection.isClosed()).toBe(true);
  await expect(
    connect({ servers: server, reconnect: false }).then(async (peer) => peer.close()),
  ).rejects.toThrow();
  expect(host.probe.timers.size).toBe(0);
  await expect(fetch(host.url)).rejects.toThrow();
});

test("a request in flight during an edit finishes on its old root", async () => {
  const host = await createDevFixture(false);
  expect(await host.ready).toEqual({ kind: "ready", url: host.url });
  const request = fetch(`${host.url}/api/slow`);
  await host.probe.entered.promise;
  await writeFile(
    join(host.directory, "shared/value.ts"),
    'export const value: string = "second";\n',
  );
  await expect.poll(() => host.probe.signals.at(0)!.aborted, { timeout: 20000 }).toBe(true);
  expect(host.probe.cleaned).toBe(0);
  expect((await fetch(`${host.url}/api/value`)).status).toBe(503);
  host.probe.release.resolve();
  expect(await (await request).json()).toEqual({ value: "first", aborted: false });
  await expect
    .poll(async () => (await fetch(`${host.url}/api/value`)).text(), { timeout: 20000 })
    .toBe('"second"');
});

test("back-to-back saves serve each new server value", async () => {
  const host = await createDevFixture(false);
  expect((await host.ready).kind).toBe("ready");
  for (let edit = 0; edit < 10; edit++) {
    const value = `edit-${edit}`;
    await writeFile(
      join(host.directory, "shared/value.ts"),
      `export const value: string = ${JSON.stringify(value)};\n`,
    );
    await expect
      .poll(async () => (await fetch(`${host.url}/api/value`)).text(), {
        interval: 5,
        timeout: 20000,
      })
      .toBe(JSON.stringify(value));
  }
});

test("stopping during a reload signals the starting root before joining it", async () => {
  const host = await createDevFixture(false);
  expect((await host.ready).kind).toBe("ready");
  await writeFile(
    join(host.directory, "shared/value.ts"),
    'export const value: string = "slow-boot";\n',
  );
  await host.probe.entered.promise;
  host.stop.abort();
  try {
    await expect.poll(() => host.probe.signals.at(-1)!.aborted).toBe(true);
  } finally {
    host.probe.release.resolve();
  }
  expect(await host.done).toBe(0);
  expect(host.probe.clients.at(-1)!.closed).toBe(true);
  await expect(fetch(host.url)).rejects.toThrow();
});

test.each(['export const value: string = "broken";', "export const value = ;"])(
  "a broken server edit serves 503 until a good edit (%s)",
  async (source) => {
    const host = await createDevFixture(false);
    expect(await host.ready).toEqual({ kind: "ready", url: host.url });
    await writeFile(join(host.directory, "shared/value.ts"), source);
    await expect.poll(() => host.events.at(-1)?.kind, { timeout: 20000 }).toBe("error");
    const failed = await fetch(`${host.url}/api/value`);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toBe("");
    await writeFile(
      join(host.directory, "shared/value.ts"),
      'export const value: string = "fixed";\n',
    );
    await expect
      .poll(async () => (await fetch(`${host.url}/api/value`)).text(), { timeout: 20000 })
      .toBe('"fixed"');
  },
);

test.each([
  { source: "export const runServer = 0;", failure: "entry" },
  { source: "export async function runServer() { throw 17; }", failure: "throw" },
  { source: "export async function runServer() { return 4; }", failure: "exit" },
])("a broken root entry stays editable on 503 ($failure)", async ({ source, failure }) => {
  const host = await createDevFixture(false);
  expect(await host.ready).toEqual({ kind: "ready", url: host.url });
  const entry = join(host.directory, "server/root.ts");
  const good = await readFile(entry, "utf8");
  await writeFile(entry, source);
  await expect.poll(() => host.events.at(-1)?.kind, { timeout: 20000 }).toBe("error");
  expect((await fetch(`${host.url}/api/value`)).status).toBe(503);
  const event = host.events.at(-1)!;
  if (event.kind !== "error") throw event;
  if (failure === "entry") {
    if (!isError(event.error, "BadDevEntry")) throw event.error;
    expect(event.error.payload).toEqual({});
  } else if (failure === "exit") {
    if (!isError(event.error, "DevRootStopped")) throw event.error;
    expect(event.error.payload.code).toBe(4);
  } else {
    expect(event.error).toBe(17);
  }
  await writeFile(entry, good);
  await expect
    .poll(async () => (await fetch(`${host.url}/api/value`)).text(), { timeout: 20000 })
    .toBe('"first"');
});

test.each([true, false])(
  "dev answers one for bad listen settings with or without a report (%s)",
  async (reporting) => {
    const errors: unknown[] = [];
    const code = await runDev(
      {
        root: "/missing/dev-app",
        entry: "root.ts",
        env: { PORT: "bad" },
        report: reporting
          ? (event) => {
              if (event.kind === "error") errors.push(event.error);
            }
          : undefined,
      },
      new AbortController().signal,
    );
    if (reporting) {
      const error = errors.at(0);
      if (!isError(error, "BadListenSettings")) throw error;
      expect(error.payload.keys).toEqual(["PORT"]);
    }
    expect(code).toBe(1);
  },
);

test("dev without a report still starts, recovers, and stops", async () => {
  const host = await createDevFixture(false, {}, false);
  await expect
    .poll(async () => (await fetch(`${host.url}/api/value`)).text(), {
      timeout: 20000,
    })
    .toBe('"first"');
  await writeFile(
    join(host.directory, "shared/value.ts"),
    'export const value: string = "broken";\n',
  );
  await expect
    .poll(async () => (await fetch(`${host.url}/api/value`)).status, {
      timeout: 20000,
    })
    .toBe(503);
  await writeFile(
    join(host.directory, "shared/value.ts"),
    'export const value: string = "fixed";\n',
  );
  await expect
    .poll(async () => (await fetch(`${host.url}/api/value`)).text(), {
      timeout: 20000,
    })
    .toBe('"fixed"');
  host.stop.abort();
  expect(await host.done).toBe(0);
});

test("dev refuses an occupied port without closing its owner", async () => {
  const owner = await createDevFixture(false);
  expect((await owner.ready).kind).toBe("ready");
  const refused = await createDevFixture(false, { PORT: new URL(owner.url).port });
  expect(await refused.done).toBe(1);
  expect(await (await fetch(`${owner.url}/api/value`)).json()).toBe("first");
});

test("a root teardown failure still closes dev services and answers one", async () => {
  const host = await createDevFixture();
  expect(await host.ready).toEqual({ kind: "ready", url: host.url });
  await writeFile(
    join(host.directory, "shared/value.ts"),
    'export const value: string = "close-broken";\n',
  );
  await expect
    .poll(async () => (await fetch(`${host.url}/api/value`)).text(), { timeout: 20000 })
    .toBe('"close-broken"');
  host.stop.abort();
  expect(await host.done).toBe(1);
  expect(host.probe.clients.at(-1)!.closed).toBe(true);
  expect(host.probe.connections.at(-1)!.isClosed()).toBe(true);
  expect(host.probe.timers.size).toBe(0);
  await expect(fetch(host.url)).rejects.toThrow();
});
