import { getEventListeners } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createDevFixture } from "./dev-fixtures.ts";

test("dev serves the app and Vite client from one listener", async () => {
  const host = await createDevFixture(false);
  expect(await host.ready).toEqual({ kind: "ready", url: host.url });
  expect(await (await fetch(`${host.url}/api/value`)).json()).toBe("first");
  expect(await (await fetch(host.url)).text()).toContain("/@vite/client");
  expect(await (await fetch(`${host.url}/client.ts`)).text()).toContain(
    'export const label = "client code"',
  );
  expect((await fetch(`${host.url}/missing`)).status).toBe(404);
  expect((await fetch(host.url, { method: "POST" })).status).toBe(404);
});

test("three server edits close old roots and keep the same database and NATS handles", async () => {
  const host = await createDevFixture();
  expect(await host.ready).toEqual({ kind: "ready", url: host.url });
  const client = host.probe.clients.at(0)!;
  const connection = host.probe.connections.at(0)!;
  await client.exec("insert into kept values ('saved')");
  for (const value of ["second", "third", "fourth"]) {
    const oldClosed = host.probe.closed.at(-1)!;
    const count = host.probe.closed.length;
    await writeFile(
      join(host.directory, "value.ts"),
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
  expect(host.probe.timers.size).toBe(0);
  await expect(fetch(host.url)).rejects.toThrow();
});

test("a request in flight during an edit finishes on its old root", async () => {
  const host = await createDevFixture(false);
  expect(await host.ready).toEqual({ kind: "ready", url: host.url });
  const request = fetch(`${host.url}/api/slow`);
  await host.probe.entered.promise;
  await writeFile(join(host.directory, "value.ts"), 'export const value: string = "second";\n');
  await expect.poll(() => host.probe.signals.at(0)!.aborted).toBe(true);
  expect(host.probe.cleaned).toBe(0);
  host.probe.release.resolve();
  expect(await (await request).json()).toEqual({ value: "first", aborted: false });
  await expect
    .poll(async () => (await fetch(`${host.url}/api/value`)).text(), { timeout: 20000 })
    .toBe('"second"');
});

test.each(['export const value: string = "broken";', "export const value = ;"])(
  "a broken server edit serves 503 until a good edit (%s)",
  async (source) => {
    const host = await createDevFixture(false);
    expect(await host.ready).toEqual({ kind: "ready", url: host.url });
    await writeFile(join(host.directory, "value.ts"), source);
    await expect.poll(() => host.events.at(-1)?.kind, { timeout: 20000 }).toBe("error");
    const failed = await fetch(`${host.url}/api/value`);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toBe("");
    await writeFile(join(host.directory, "value.ts"), 'export const value: string = "fixed";\n');
    await expect
      .poll(async () => (await fetch(`${host.url}/api/value`)).text(), { timeout: 20000 })
      .toBe('"fixed"');
  },
);
