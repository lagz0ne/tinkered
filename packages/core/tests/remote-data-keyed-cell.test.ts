import { memory } from "@tinker/core/testing";
import { afterEach, expect, expectTypeOf, test } from "vite-plus/test";
import { z } from "zod";

import { createScope, data, operation, remoteData, tag, transport } from "@/main";
import type { Observe, Scope } from "@/main";

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
  let refuseAsks = false;
  let gate: { reached: boolean; release: () => void; wait: Promise<void> } | undefined;
  const guard = operation({
    label: "guard",
    input: hook.start,
    run: async (_, { input }) => {
      seen.push({ key: input.key, input: input.input });
      const part = Object(Object(input.input).part) as { project?: string };
      const asked = input.key === "tasks.ask";
      if ((options.refuse && part.project === options.refuse) || (refuseAsks && asked)) {
        return input.refuse({ project: part.project });
      }

      const held = asked ? gate : undefined;
      gate = undefined;
      if (held) {
        held.reached = true;
        await held.wait;
      }
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
  const holdAsk = () => {
    let release = () => undefined as void;
    const wait = new Promise<void>((done) => (release = done));
    gate = { reached: false, release, wait };
    return gate;
  };
  const refuse = (on: boolean) => (refuseAsks = on);
  return { server, client, write, seen, ended, holdAsk, refuseAsks: refuse };
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
  const p2 = tab.resolve(board.status(board.tasks.where({ project: "p2" })));
  await until(() => p1.read().length > 0 && p2.get()?.status === "fault");

  expect(p2.get()).toMatchObject({ status: "fault", fault: { fault: "refused" } });
  expect(tab.resolve(board.status(board.tasks.where({ project: "p1" }))).get()).toMatchObject({
    status: "ready",
  });
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

test("an ask from the wire that is not a part is invalid", async () => {
  const app = await boot();
  const bad = [
    { read: "all", part: { project: "p1" } },
    { read: "where", part: null },
    { read: "where", part: ["p1"] },
    { read: "where", part: { project: { deep: "p1" } } },
    { read: "where", part: { n: Number.NaN } },
    { read: "where" },
  ];

  const replies = await Promise.all(
    bad.map((value) =>
      app.server.run(board.answer, { input: { address: "tasks.ask", value, meta: {} } }),
    ),
  );
  const good = await app.server.run(board.answer, {
    input: { address: "tasks.ask", value: { read: "of", part: "x" }, meta: {} },
  });

  expect(replies.map((r) => Object(r).kind)).toEqual(bad.map(() => "invalid"));
  expect(good).toEqual({ ok: true, value: [] });
});

test("a part names one slot whatever the order of its fields", async () => {
  const app = await boot();
  const tab = await app.client();
  const one = tab.resolve(board.tasks.where({ id: "a", project: "p1" }));
  one.watch(() => undefined);
  await until(() => one.get().length > 0);

  await app.write(task("p1", "a", "renamed"));
  await until(() => one.get()[0]?.title === "renamed");

  expect(app.seen.filter((s) => s.key === "tasks.ask").map((s) => s.input)).toEqual([
    { read: "where", part: { id: "a", project: "p1" } },
    { read: "of", part: { project: "p1", id: "a" } },
  ]);
});

test("a member held by another part stays when one part leaves", async () => {
  const app = await boot();
  const tab = await app.client();
  const byProject = watchPart(tab, "p1");
  const byId = tab.resolve(board.tasks.where({ id: "a" }));
  const stop = byId.watch(() => undefined);
  await until(() => byProject.read().length > 0 && byId.get().length > 0);

  byProject.stop();
  const kept = all(tab);
  stop();

  expect(kept).toEqual([task("p1", "a")]);
  expect(all(tab)).toEqual([]);
});

test("a root and a session that read one part share one stream", async () => {
  const app = await boot();
  const tab = await app.client();
  const session = tab.createSession();
  const root = watchPart(tab, "p1");
  const own = watchPart(session, "p1");
  await until(() => root.read().length > 0 && own.read().length > 0);

  root.stop();
  await app.write(task("p1", "a", "renamed"));
  await until(() => own.read()[0]?.title === "renamed");

  expect(app.seen.filter((s) => s.key === "tasks")).toHaveLength(1);
  expect(app.ended).not.toContain("tasks");
  own.stop();
  await session.close();
});

test("a refused ask is a fault, and the next good answer clears it", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = watchPart(tab, "p1");
  await until(() => p1.read().length > 0);
  const faults = () => tab.resolve(board.faults).get().tasks;

  app.refuseAsks(true);
  await tab.run(board.invalidate, { input: { tasks: { project: "p1" } } });
  const refused = faults();
  app.refuseAsks(false);
  await tab.run(board.invalidate, { input: { tasks: { project: "p1" } } });

  expect(refused).toMatchObject({ fault: "refused" });
  expect(faults()).toBe(undefined);
});

test("an answer for a part that left is dropped", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = watchPart(tab, "p1");
  const p2 = watchPart(tab, "p2");
  await until(() => p1.read().length > 0 && p2.read().length > 0);

  const held = app.holdAsk();
  const asked = tab.run(board.invalidate, { input: { tasks: { project: "p1" } } });
  await until(() => held.reached);
  p1.stop();
  held.release();
  await asked;

  expect(all(tab)).toEqual([task("p2", "b")]);
});

test("the server's own view of the board holds every member", async () => {
  const app = await boot();

  await app.write(task("p1", "c"));

  expect(app.server.resolve(board.tasks).get()).toEqual([
    task("p1", "a"),
    task("p2", "b"),
    task("p1", "c"),
  ]);
});

test("a keyed board takes no config, and invalidate is a reserved key", () => {
  const project = tag<string>({ label: "project" });

  const withConfig = () => remoteData({ tasks }, { config: { project } });
  const reserved = () => remoteData({ invalidate: data({ initial: 0 }) });

  expect(withConfig).toThrow("a keyed cell takes no config");
  expect(reserved).toThrow("invalidate is a reserved key");
});

test("an of and a where of one key are two parts on the client", async () => {
  const app = await boot();
  const tab = await app.client();
  const one = tab.resolve(board.tasks.of({ project: "p1", id: "a" }));
  one.watch(() => undefined);
  const pair = tab.resolve(board.tasks.where({ project: "p1", id: "a" }));
  const stop = pair.watch(() => undefined);
  await until(() => one.get() !== undefined && pair.get().length > 0);

  stop();

  expect(one.get()).toEqual(task("p1", "a"));
  expect(all(tab)).toEqual([task("p1", "a")]);
});

test("a reader still gets signals after another client leaves its part", async () => {
  const app = await boot();
  const [a, b] = await Promise.all([app.client(), app.client()]);
  const left = watchPart(a, "p1");
  const stays = watchPart(b, "p1");
  await until(() => left.read().length > 0 && stays.read().length > 0);

  left.stop();
  await until(() => app.ended.includes("tasks"));
  await app.write(task("p1", "a", "renamed"));
  await until(() => stays.read()[0]?.title === "renamed");

  expect(stays.read()).toEqual([task("p1", "a", "renamed")]);
});

test("a member stays only for a part that matches it on every field", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = watchPart(tab, "p1");
  const other = tab.resolve(board.tasks.where({ project: "p2", id: "a" }));
  other.watch(() => undefined);
  await until(() => p1.read().length > 0);

  p1.stop();

  expect(all(tab)).toEqual([]);
  expect(board.invalidate.label).toBe("remoteData.invalidate");
});

test("a part that a part in use holds whole rides its stream and asks once per set", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = watchPart(tab, "p1");
  await until(() => p1.read().length > 0);
  const one = tab.resolve(board.tasks.of({ project: "p1", id: "a" }));
  one.watch(() => undefined);
  const before = app.seen.length;

  await app.write(task("p1", "a", "renamed"));
  await until(() => one.get()?.title === "renamed");

  expect(app.seen.filter((s) => s.key === "tasks")).toHaveLength(1);
  expect(app.seen.slice(before)).toEqual([
    { key: "tasks.ask", input: { read: "of", part: { project: "p1", id: "a" } } },
  ]);
});

test("a part whose cover leaves gets its own stream and stays fresh", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = watchPart(tab, "p1");
  await until(() => p1.read().length > 0);
  const one = tab.resolve(board.tasks.of({ project: "p1", id: "a" }));
  one.watch(() => undefined);

  p1.stop();
  await until(() => app.seen.filter((s) => s.key === "tasks").length === 2);
  await app.write(task("p1", "a", "renamed"));
  await until(() => one.get()?.title === "renamed");

  expect(app.seen.filter((s) => s.key === "tasks").map((s) => s.input)).toEqual([
    { read: "where", part: { project: "p1" } },
    { read: "of", part: { project: "p1", id: "a" } },
  ]);
  expect(all(tab)).toEqual([task("p1", "a", "renamed")]);
});

test("a part whose cover leaves rides another cover, and a part with its own stream keeps it", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = watchPart(tab, "p1");
  const p2 = watchPart(tab, "p2");
  const byId = tab.resolve(board.tasks.where({ id: "a" }));
  byId.watch(() => undefined);
  await until(() => p1.read().length > 0 && p2.read().length > 0);
  const one = tab.resolve(board.tasks.of({ project: "p1", id: "a" }));
  one.watch(() => undefined);
  const streams = () => app.seen.filter((s) => s.key === "tasks").length;

  p1.stop();
  await new Promise((done) => setTimeout(done, 30));
  await app.write(task("p1", "a", "renamed"));
  await until(() => one.get()?.title === "renamed");

  expect(streams()).toBe(3);
});

test("a write's signal carries its send span, and the reader's ask links it", async () => {
  const add = operation({
    label: "tasks.add",
    input: Task,
    depends: { items: tasks.controller },
    run: ({ items }, { input }) => items.set(input),
  });
  // As an op that writes its store, then calls invalidate: the send is in the writer's trace.
  const touch = operation({
    label: "tasks.touch",
    depends: { invalidate: board.invalidate },
    run: ({ invalidate }) => invalidate.run({ input: { tasks: { project: "p1", id: "a" } } }),
  });
  const sent: Observe.Span[] = [];
  const server = await createScope({
    observe: { export: (x) => void sent.push(x) },
    capsules: [board({ serve: true }), memory.server({ services: [board] })],
  }).ready;
  closers.push(() => server.close());
  const taken: Observe.Span[] = [];
  const tab = await createScope({
    observe: { export: (x) => void taken.push(x) },
    capsules: [memory.client({ peer: server }), board({ read: memory.client })],
  }).ready;
  closers.push(() => tab.close());
  const p1 = tab.resolve(board.tasks.where({ project: "p1" }));
  p1.watch(() => undefined);
  const receives = () => taken.filter((x) => x.name === "remoteData.receive");
  const sends = () => sent.filter((x) => x.name === "remoteData.send");
  await until(() => receives().length === 1); // the join's first signal: the part itself

  server.run(add, { input: task("p1", "a") });
  await until(() => p1.get().length === 1 && receives().length === 2);
  await server.run(touch);
  await until(() => receives().length === 3);

  const linked = (send: Observe.Span, receive: Observe.Span) => {
    const traceparent = `00-${send.traceId}-${send.spanId}-01`;
    expect(receive.events.map((e) => [e.name, e.attributes])).toEqual([["link", { traceparent }]]);
    expect(receive.attributes).toMatchObject({ "messaging.operation.type": "process" });
    const under = taken.filter((x) => x.traceId === receive.traceId).map((x) => x.name);
    expect(under).toContain("tasks.ask");
  };
  expect(sends()[0]!.attributes).toMatchObject({
    "messaging.operation.type": "send",
    "messaging.destination.name": "tasks",
  });
  linked(sends()[0]!, receives()[1]!);
  const writer = sent.find((x) => x.name === "tasks.touch")!;
  expect(sends()[1]!.traceId).toBe(writer.traceId);
  expect(sends()[1]!.attributes).toMatchObject({ "messaging.destination.name": "tasks" });
  linked(sends()[1]!, receives()[2]!);
});

test("a guard reads the part with its type: a join and an ask give it, another call none", () => {
  const join = board.part({ key: "tasks", input: { read: "where", part: { project: "p1" } } });
  const ask = board.part({ key: "tasks.ask", input: { read: "of", part: task("p1", "a") } });

  expectTypeOf(join).toEqualTypeOf<
    { readonly project?: string; readonly id?: string } | undefined
  >();
  expect(join?.project).toBe("p1");
  expect(ask?.id).toBe("a");
  expect(board.part({ key: "other", input: {} })).toBeUndefined();
});

test("a refused part waits for a trigger: no ask again until an invalidate names it", async () => {
  const app = await boot({ refuse: "p2" });
  const tab = await app.client();
  const opens = () => app.seen.filter((s) => s.key === "tasks").length;
  const state = tab.resolve(board.status(board.tasks.where({ project: "p2" })));

  const p2 = watchPart(tab, "p2");
  await until(() => state.get()?.status === "fault");
  const first = opens();
  await new Promise((done) => setTimeout(done, 400));

  expect(opens()).toBe(first);
  await tab.run(board.invalidate, { input: { tasks: { project: "p2" } } });
  await until(() => opens() > first);
  p2.stop();
});

test("a part is pending until its first answer, ready with no member, gone when it leaves", async () => {
  const app = await boot();
  const tab = await app.client();
  const read = board.tasks.where({ project: "p9" });
  const state = tab.resolve(board.status(read));

  expect(state.get()).toBeUndefined();
  const p9 = watchPart(tab, "p9");
  expect(state.get()).toMatchObject({ status: "pending" }); // the join, before any answer
  await until(() => state.get()?.status === "ready");

  expect(p9.read()).toEqual([]);
  p9.stop();
  expect(state.get()).toBeUndefined();
});

test("a part that rides a ready part is ready at once", async () => {
  const app = await boot();
  const tab = await app.client();
  const all = tab.resolve(board.tasks.where({}));
  const stop = all.watch(() => undefined);
  const whole = tab.resolve(board.status(board.tasks.where({})));
  await until(() => whole.get()?.status === "ready");

  const one = watchPart(tab, "p1");
  const state = tab.resolve(board.status(board.tasks.where({ project: "p1" })));

  expect(state.get()).toMatchObject({ status: "ready" });
  one.stop();
  stop();
});

test("a ready part that an ask refuses goes to fault, and keeps its members", async () => {
  const app = await boot();
  const tab = await app.client();
  const state = tab.resolve(board.status(board.tasks.where({ project: "p1" })));
  const p1 = watchPart(tab, "p1");
  await until(() => state.get()?.status === "ready");

  app.refuseAsks(true);
  await tab.run(board.invalidate, { input: { tasks: { project: "p1" } } });
  await until(() => state.get()?.status === "fault");

  expect(state.get()).toMatchObject({ status: "fault", fault: { fault: "refused" } });
  expect(p1.read()).toEqual([task("p1", "a")]);
  p1.stop();
});

test("a part no server serves is the server's missing, and waits as an answer does", async () => {
  const server = await createScope({ capsules: [memory.server({ services: [] })] }).ready;
  closers.push(() => server.close());
  const tab = await createScope({
    capsules: [memory.client({ peer: server }), board({ read: memory.client })],
  }).ready;
  closers.push(() => tab.close());
  const state = tab.resolve(board.status(board.tasks.where({ project: "p1" })));
  let told = 0;
  const unwatch = state.watch(() => void told++);

  const p1 = watchPart(tab, "p1");
  await until(() => state.get()?.status === "fault");
  const first = told;
  await new Promise((done) => setTimeout(done, 400));

  expect(state.get()).toMatchObject({
    status: "fault",
    fault: { fault: "missing", from: "server" },
  });
  expect(told).toBe(first); // a link would heal with back-off: 50, 100, 200 ms
  p1.stop();
  unwatch();
});
