import { memory } from "@tinker/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { createScope, data, operation, remoteData, transport } from "@/main";
import type { Scope } from "@/main";

const { hook } = transport;

type Task = { project: string; id: string; title: string };

const Task = z.object({ project: z.string(), id: z.string(), title: z.string() });

const tasks = data({
  label: "task.items",
  mode: "keyed",
  parse: Task,
  key: (t) => ({ project: t.project, id: t.id }),
});

const board = remoteData({ tasks });

const task = (project: string, id: string, title = id): Task => ({ project, id, title });

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

/** A server with two projects, and its clients. `seen` lists each call's address and input. */
async function boot(options: { refuse?: string } = {}) {
  const seen: { key: string; input: unknown }[] = [];
  const ended: string[] = [];
  const guard = operation({
    label: "guard",
    input: hook.start,
    run: (_, { input }) => {
      seen.push({ key: input.key, input: input.input });
      const part = Object(Object(input.input).part) as { project?: string };
      return part.project === options.refuse ? input.refuse({ project: part.project }) : undefined;
    },
  });
  const finished = operation({
    label: "finished",
    input: hook.finish,
    run: (_, { input }) => void ended.push(input.key),
  });
  const add = operation({
    label: "tasks.add",
    input: Task,
    depends: { items: tasks.controller },
    run: ({ items }, { input }) => items.set(input),
  });

  const server = await createScope({
    capsules: [
      board({ serve: true, onStart: [guard], onFinish: [finished] }),
      memory.server({ services: [board] }),
    ],
  }).ready;
  closers.push(() => server.close());
  await server.run(add, { input: task("p1", "a") });
  await server.run(add, { input: task("p2", "b") });

  const client = async () => {
    const scope = await createScope({
      capsules: [memory.client({ peer: server }), board({ read: memory.client })],
    }).ready;
    closers.push(() => scope.close());
    return scope;
  };
  const write = (t: Task) => server.run(add, { input: t, tags: [] });
  return { server, client, write, seen, ended };
}

/** A client's reader of a part, kept in use until `stop`. */
const watchPart = (scope: Scope.Handle, project: string) => {
  const reader = scope.resolve(board.tasks.where({ project }));
  return { read: () => reader.get(), stop: reader.watch(() => undefined) };
};

const all = (scope: Scope.Handle) => scope.resolve(board.tasks).get();

test("two clients read two parts and each gets only its members", async () => {
  const app = await boot();
  const [a, b] = await Promise.all([app.client(), app.client()]);

  const p1 = watchPart(a, "p1");
  const p2 = watchPart(b, "p2");
  await until(() => p1.read().length > 0 && p2.read().length > 0);

  expect(all(a)).toEqual([task("p1", "a")]);
  expect(all(b)).toEqual([task("p2", "b")]);
  p1.stop();
  p2.stop();
});

test("the guard gets the part at each ask and can refuse it", async () => {
  const app = await boot({ refuse: "p2" });
  const tab = await app.client();

  const p1 = watchPart(tab, "p1");
  watchPart(tab, "p2");
  await until(() => p1.read().length > 0 && tab.resolve(board.faults).get().tasks !== undefined);

  expect(tab.resolve(board.faults).get().tasks).toMatchObject({ fault: "refused" });
  expect(app.seen).toContainEqual({
    key: "tasks.ask",
    input: { read: "where", part: { project: "p1" } },
  });
  expect(all(tab)).toEqual([task("p1", "a")]);
});

test("a write from a request session lands at the root, and no session keeps a copy", async () => {
  const app = await boot();
  const session = app.server.createSession();

  await session.run(
    operation({
      label: "tasks.rename",
      depends: { items: tasks.controller },
      run: ({ items }) =>
        items.update({ project: "p1", id: "a" }, (t) => ({ ...t, title: "renamed" })),
    }),
  );
  await session.close();

  expect(app.server.controller(tasks).of({ project: "p1", id: "a" }).get()?.title).toBe("renamed");
});

test("a client whose link drops asks again", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = watchPart(tab, "p1");
  await until(() => p1.read().length > 0);
  const asks = () => app.seen.filter((s) => s.key === "tasks.ask").length;
  const before = asks();

  await app.server.run(board.drop);
  await until(() => asks() > before);

  expect(p1.read()).toEqual([task("p1", "a")]);
  p1.stop();
});

test("after the last reader leaves, the stream ends and the client's part goes", async () => {
  const app = await boot();
  const tab = await app.client();
  const first = watchPart(tab, "p1");
  const second = watchPart(tab, "p1");
  await until(() => first.read().length > 0);

  first.stop();
  const kept = all(tab);
  second.stop();
  await until(() => app.ended.includes("tasks"));

  expect(kept).toEqual([task("p1", "a")]);
  expect(all(tab)).toEqual([]);
});

test("a member also read by key stays when its part leaves", async () => {
  const app = await boot();
  const tab = await app.client();
  const one = tab.resolve(board.tasks.of({ project: "p1", id: "a" }));
  one.watch(() => undefined);
  const part = watchPart(tab, "p1");
  await until(() => one.get() !== undefined && part.read().length > 0);

  part.stop();

  expect(all(tab)).toEqual([task("p1", "a")]);
});
