/**
 * A parked part (one that waits on a fault, ADR 0139 4) keeps its fault until a trigger: a late
 * answer, the part that rides it, and a live part that holds it do not make it ready. An awaited
 * `invalidate` that wakes it ends, even when the new stream is refused or the part leaves
 * (ADR 0147 d4).
 */
import { memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { createScope, data, operation, remoteData, transport } from "@/main";
import type { Data } from "@/main";

const { hook } = transport;

type Task = { project: string; id: string; title: string };

const Task = z.object({ project: z.string(), id: z.string(), title: z.string() });

const tasks = data({
  label: "parked.tasks",
  mode: "keyed",
  parse: Task,
  key: (t) => ({ project: t.project, id: t.id }),
});

const board = remoteData({ tasks });

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const until = async (ok: () => boolean) => {
  for (let tries = 0; !ok(); tries++) {
    if (tries > 300) throw new Error("timed out");
    await new Promise((done) => setTimeout(done, 10));
  }
};

/** A point the server's guard holds a call at, until `open`. */
const gate = () => {
  let open = () => undefined as void;
  const wait = new Promise<void>((done) => (open = done));
  return { reached: false, open, wait };
};

/**
 * A server with task p1/a, and a client. The guard refuses the next `rules.refuse` watches, and
 * holds the next watch or ask at `rules.watch` or `rules.ask` until that gate opens.
 */
async function boot() {
  const rules = {
    refuse: 0,
    watch: undefined as ReturnType<typeof gate> | undefined,
    ask: undefined as ReturnType<typeof gate> | undefined,
  };
  const guard = operation({
    label: "parked.guard",
    input: hook.start,
    run: async (_, { input }) => {
      const watching = input.key === "tasks";
      const held = watching ? rules.watch : rules.ask;
      if (watching) rules.watch = undefined;
      else rules.ask = undefined;
      if (held) {
        held.reached = true;
        await held.wait;
      }

      if (watching && rules.refuse > 0) {
        rules.refuse--;
        return input.refuse({ why: "closed" });
      }
    },
  });
  const add = operation({
    label: "parked.add",
    input: Task,
    depends: { items: tasks.controller },
    run: ({ items }, { input }) => items.set(input),
  });

  const server = await createScope({
    capsules: [board({ serve: true, onStart: [guard] }), memory.server({ services: [board] })],
  }).ready;
  closers.push(() => server.close());
  server.run(add, { input: { project: "p1", id: "a", title: "a" } });

  const tab = await createScope({
    capsules: [memory.client({ peer: server }), board({ read: memory.client })],
  }).ready;
  closers.push(() => tab.close());

  /** A reader kept in use until the test ends; `status` is its part's state. */
  const read = <T>(part: Data.Read<T>) => {
    closers.push(tab.resolve(part).watch(() => undefined));
    return () => tab.resolve(board.status(part)).get();
  };
  const invalidate = () => tab.run(board.invalidate, { input: { tasks: { project: "p1" } } });
  return { rules, tab, read, invalidate };
}

test("a late answer leaves a parked part and the part that rides it in their fault", async () => {
  const app = await boot();
  app.rules.refuse = 1;
  const watchHeld = (app.rules.watch = gate());
  const askHeld = (app.rules.ask = gate());
  const wide = app.read(board.tasks.where({ project: "p1" }));
  await until(() => watchHeld.reached);
  const invalidated = app.invalidate();
  await until(() => askHeld.reached);
  watchHeld.open();
  await until(() => wide()?.status === "fault");
  const rider = app.read(board.tasks.of({ project: "p1", id: "a" }));

  askHeld.open();
  await invalidated;

  expect(wide()).toMatchObject({ status: "fault", fault: { fault: "refused" } });
  expect(rider()).toMatchObject({ status: "fault", fault: { fault: "refused" } });
});

test("a live part's answer leaves a parked part it holds in its fault", async () => {
  const app = await boot();
  app.rules.refuse = 1;
  const one = app.read(board.tasks.of({ project: "p1", id: "a" }));
  await until(() => one()?.status === "fault");

  const wide = app.read(board.tasks.where({ project: "p1" }));
  await until(() => wide()?.status === "ready");

  expect(one()).toMatchObject({ status: "fault", fault: { fault: "refused" } });
});

test("await invalidate on a parked part ends when its new stream is refused again", async () => {
  const app = await boot();
  app.rules.refuse = 2;
  const wide = app.read(board.tasks.where({ project: "p1" }));
  await until(() => wide()?.status === "fault");

  await app.invalidate();

  expect(app.rules.refuse).toBe(0);
  expect(wide()).toMatchObject({ status: "fault", fault: { fault: "refused" } });
});

test("await invalidate on a parked part ends when the part leaves before its new stream opens", async () => {
  const app = await boot();
  app.rules.refuse = 2;
  const part = board.tasks.where({ project: "p1" });
  const stop = app.tab.resolve(part).watch(() => undefined);
  await until(() => app.tab.resolve(board.status(part)).get()?.status === "fault");
  const watchHeld = (app.rules.watch = gate());
  const invalidated = app.invalidate();
  await until(() => watchHeld.reached);

  stop();
  watchHeld.open();

  await expect(invalidated).resolves.toBeUndefined();
});
