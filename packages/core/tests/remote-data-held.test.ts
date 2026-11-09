import { memory } from "@tinker/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { createScope, data, operation, remoteData, tag } from "@/main";
import type { Observe, Scope } from "@/main";

// What a server holds for a keyed watch: the value now, kept while someone watches, and a write
// that lands while the fill still runs.

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

const tasks = data({ initial: [] as string[], parse: z.array(z.string()) });

const board = remoteData(
  { tasks },
  { config: { project: tag<string>({ label: "project", parse: z.string() }) } },
);

/** A server whose fill waits for `release` when `slow` is set, and counts its calls. */
async function boot(spans: Observe.Span[] = []) {
  const state = { fills: 0, slow: false, release: () => {} };
  const fill = operation({
    label: "tasks.fill",
    depends: { key: board.project },
    run: async ({ key }) => {
      state.fills++;
      if (state.slow) await new Promise<void>((done) => (state.release = done));
      return [`${key} first`];
    },
  });
  const set = operation({
    label: "tasks.set",
    input: z.array(z.string()),
    depends: { list: tasks.controller },
    run: ({ list }, { input }) => list.set(input),
  });
  const server = await createScope({
    observe: { export: (s) => void spans.push(s) },
    capsules: [board({ serve: true, fill: { tasks: fill } }), memory.server({ services: [board] })],
  }).ready;
  closers.push(() => server.close());

  const write = (project: string, list: string[]) =>
    server.run(set, { input: list, tags: [board.project(project)] });
  const client = async (): Promise<Scope.Handle> => {
    const tab = await createScope({
      capsules: [memory.client({ peer: server }), board({ read: memory.client })],
    }).ready;
    closers.push(() => tab.close());
    return tab;
  };

  return { server, state, write, client };
}

const read = (s: Scope.Handle) => s.resolve(board.tasks).get();

test("a write that lands while the fill runs is the first value, not the fill's", async () => {
  const app = await boot();
  app.state.slow = true;
  const tab = await app.client();

  const s = tab.createSession({ tags: [board.project("p1")] });
  await until(() => app.state.fills === 1);
  void app.write("p1", ["written"]);
  app.state.release();
  await until(() => read(s).length > 0);
  await tick();

  expect(read(s)).toEqual(["written"]);
});

test("a second client on a watched project reads the held value: no new fill", async () => {
  const app = await boot();
  const [a, b] = [await app.client(), await app.client()];

  const one = a.createSession({ tags: [board.project("p1")] });
  await until(() => read(one).length > 0);
  void app.write("p1", ["changed"]);
  await until(() => read(one)[0] === "changed");

  const two = b.createSession({ tags: [board.project("p1")] });
  await until(() => read(two).length > 0);
  expect(read(two)).toEqual(["changed"]);
  expect(app.state.fills).toBe(1);
});

test("one watcher leaving keeps the value for the others; the last one leaving drops it", async () => {
  const app = await boot();
  const [a, b, c] = [await app.client(), await app.client(), await app.client()];

  // One after the other: two first watches at once would both fill.
  const one = a.createSession({ tags: [board.project("p1")] });
  await until(() => read(one).length > 0);
  const two = b.createSession({ tags: [board.project("p1")] });
  await until(() => read(two).length > 0);
  await a.close();
  await tick();

  const three = c.createSession({ tags: [board.project("p1")] });
  await until(() => read(three).length > 0);
  expect(app.state.fills).toBe(1);

  await b.close();
  await c.close();
  await tick();
  const d = await app.client();
  const four = d.createSession({ tags: [board.project("p1")] });
  await until(() => read(four).length > 0);
  expect(app.state.fills).toBe(2);
});

test("a write with no watchers is kept by no one: the next watch fills afresh", async () => {
  const app = await boot();

  void app.write("p1", ["unseen"]);
  const tab = await app.client();
  const s = tab.createSession({ tags: [board.project("p1")] });
  await until(() => read(s).length > 0);

  expect(read(s)).toEqual(["p1 first"]);
});

test("each write is one send span, for its key and its watchers", async () => {
  const spans: Observe.Span[] = [];
  const app = await boot(spans);
  const [a, b] = [await app.client(), await app.client()];
  const one = a.createSession({ tags: [board.project("p1")] });
  const two = b.createSession({ tags: [board.project("p1")] });
  await until(() => read(one).length > 0 && read(two).length > 0);
  await tick();

  void app.write("p1", ["x"]);
  await until(() => read(one)[0] === "x" && read(two)[0] === "x");

  const sends = spans.filter((s) => s.name === "remoteData.send");
  expect(sends.map((s) => s.attributes)).toEqual([
    expect.objectContaining({
      "messaging.operation.type": "send",
      "messaging.destination.name": "tasks",
      "messaging.batch.message_count": 2,
    }),
  ]);
});

test("an unkeyed write in a session reaches the root's own cell, and its watchers", async () => {
  const cell = data({ initial: 0 });
  const plain = remoteData({ cell });
  const bump = operation({
    label: "bump",
    depends: { c: cell.controller },
    run: ({ c }) => c.set(c.get() + 1),
  });
  const server = await createScope({
    capsules: [plain({ serve: true }), memory.server({ services: [plain] })],
  }).ready;
  closers.push(() => server.close());
  const tab = await createScope({
    capsules: [memory.client({ peer: server }), plain({ read: memory.client })],
  }).ready;
  closers.push(() => tab.close());
  await tick();

  const session = server.createSession({});
  session.run(bump);
  await session.close();

  expect(server.resolve(cell)).toBe(1);
  expect(server.resolve(plain.cell).get()).toBe(1);
  await until(() => tab.resolve(plain.cell).get() === 1);
});
