import { memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { createScope, data, operation, remoteData, tag, transport } from "@/main";
import type { Observe, Scope } from "@/main";

// remoteData at its edges: the names it keeps, the config it takes, a dropped link, the logs.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

const until = async (ok: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await tick(10);
  }
};

const startOf = (capsules: unknown[]) =>
  createScope({ capsules: capsules as never }).ready.then(
    (scope) => (closers.push(() => scope.close()), null),
    (e: unknown) => e,
  );

test("answer, stream, drop, fault and faults are the definition's names, not keys", () => {
  for (const key of ["answer", "stream", "drop", "fault", "faults"]) {
    expect(() => remoteData({ [key]: data({ initial: 0 }) }), key).toThrow(
      `remoteData: ${key} is a reserved key`,
    );
  }
  expect(() => remoteData({ answers: data({ initial: 0 }) })).not.toThrow();
});

test("a config key may not be a cell or a reserved name", () => {
  const t = tag<string>({ label: "t" });

  expect(() => remoteData({ a: data({ initial: 0 }) }, { config: { a: t } })).toThrow(
    "remoteData: config a is a cell or reserved key",
  );
  expect(() => remoteData({ a: data({ initial: 0 }) }, { config: { drop: t } })).toThrow(
    "remoteData: config drop is a cell or reserved key",
  );
  expect(() => remoteData({ a: data({ initial: 0 }) }, { config: { b: t } })).not.toThrow();
});

test("a definition takes one job: serve or read, not both and not neither", async () => {
  const board = remoteData({ a: data({ initial: 0 }) });
  const missing = { kind: "MissingConfig", payload: { label: "remoteData", key: "serve | read" } };

  expect(await startOf([board({} as never)])).toMatchObject({
    payload: { label: "remoteData", key: "implement | remote" },
  });
  expect(await startOf([board({ serve: true, read: memory.client } as never)])).toMatchObject(
    missing,
  );
});

test("its ops carry the remoteData label; the keys are the addresses", () => {
  const board = remoteData({ a: data({ initial: 0 }), b: data({ initial: "" }) });

  expect([board.answer.label, board.stream.label, board.drop.label]).toEqual([
    "remoteData.answer",
    "remoteData.stream",
    "remoteData.drop",
  ]);
  expect(board.addresses).toEqual(["a", "b"]);
});

/** A served cell and a reader of it; `opens` counts each watch the server starts. */
async function pair(cell = data({ initial: 1 }), logs: Observe.Log[] = []) {
  const board = remoteData({ cell });
  let opens = 0;
  const count = operation({
    label: "count",
    input: transport.hook.start,
    run: () => void opens++,
  });
  const server = await createScope({
    capsules: [board({ serve: true, onStart: [count] }), memory.server({ services: [board] })],
  }).ready;
  closers.push(() => server.close());
  const client = await createScope({
    observe: { log: (entry) => void logs.push(entry) },
    capsules: [memory.client({ peer: server }), board({ read: memory.client })],
  }).ready;
  closers.push(() => client.close());
  const bump = operation({
    label: "bump",
    input: z.unknown(),
    depends: { c: cell.controller },
    run: ({ c }, { input }) => c.set(input as never),
  });

  return { board, server, client, bump, opens: () => opens };
}

test("drop ends every watch; the reader opens again and reads on", async () => {
  const { board, server, client, bump, opens } = await pair();
  await tick();
  expect(opens()).toBe(1);

  server.run(board.drop);
  await until(() => opens() === 2);
  await tick();
  server.run(bump, { input: 5 });
  await until(() => client.resolve(board.cell).get() === 5);
});

test("a pushed value the cell refuses is logged on the reader, with the address", async () => {
  const logs: Observe.Log[] = [];
  // A value that slips past the server (no parse there) is refused by the reader's parse.
  const loose = data({ initial: 1 });
  const strict = data({ initial: 1, parse: z.number() });
  const served = remoteData({ v: loose });
  const read = remoteData({ v: strict });
  const set = operation({
    label: "set",
    depends: { c: loose.controller },
    run: ({ c }) => c.set("two" as never),
  });
  const server2 = await createScope({
    capsules: [served({ serve: true }), memory.server({ services: [served] })],
  }).ready;
  closers.push(() => server2.close());
  const reader: Scope.Handle = await createScope({
    observe: { log: (entry) => void logs.push(entry) },
    capsules: [memory.client({ peer: server2 }), read({ read: memory.client })],
  }).ready;
  closers.push(() => reader.close());
  await tick();
  server2.run(set);
  await until(() => reader.resolve(read.faults).get().v !== undefined);

  expect(reader.resolve(read.faults).get().v).toMatchObject({
    fault: "invalid",
    payload: { side: "client" },
  });
  expect(logs.find((l) => l.message === "remoteData value refused")?.attributes).toMatchObject({
    address: "v",
    why: "SchemaRejected",
  });
});
