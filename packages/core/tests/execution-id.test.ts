import { memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { createScope, data, execution, operation, remoteData, rpc, transport } from "@/main";
import type { Observe, Scope } from "@/main";

const { hook } = transport;

// The execution id (ADR 0147): a call ends at its reply, as a TanStack Query mutation does. The
// id is the fault's ref; reading your own write is `board.invalidate`, as `invalidateQueries`.

type Task = { project: string; id: string; title: string };

const Task = z.object({ project: z.string(), id: z.string(), title: z.string() });

const tasks = data({
  label: "task.items",
  mode: "keyed",
  parse: Task,
  key: (t) => ({ project: t.project, id: t.id }),
});

const board = remoteData({ tasks });

const api = rpc({
  add: { input: Task, output: z.string() },
});

const task = (project: string, id: string): Task => ({ project, id, title: id });

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

/** A server whose `add` writes the keyed cell and returns the id it ran under. */
async function boot() {
  const asks: string[] = [];
  let gate: Promise<void> | undefined;
  const guard = operation({
    label: "guard",
    input: hook.start,
    run: async (_, { input }) => {
      if (input.key !== "tasks.ask") return;
      asks.push(JSON.stringify(Object(input.input).part));
      await gate;
    },
  });
  const add = operation({
    label: "add",
    input: Task,
    depends: { items: tasks.controller, id: execution.optional },
    run: ({ items, id }, { input }) => (items.set(input), id.present ? id.value : "none"),
  });
  const server = await createScope({
    capsules: [
      board({ serve: true, onStart: [guard] }),
      api({ implement: { add } }),
      memory.server({ services: [board, api] }),
    ],
  }).ready;
  closers.push(() => server.close());

  const client = async () => {
    const scope = await createScope({
      capsules: [
        memory.client({ peer: server }),
        board({ read: memory.client }),
        api({ remote: memory.client }),
      ],
    }).ready;
    closers.push(() => scope.close());
    return scope;
  };
  /** Holds every ask at the server until `release`. */
  const hold = () => {
    let release = () => undefined as void;
    gate = new Promise<void>((done) => (release = done));
    return () => ((gate = undefined), release());
  };
  return { server, client, asks, hold };
}

/** A client's reader of a part, kept in use until `stop`. */
const watchPart = (scope: Scope.Handle, project: string) => {
  const reader = scope.resolve(board.tasks.where({ project }));
  return { read: () => reader.get(), stop: reader.watch(() => undefined) };
};

const opened = async (app: { asks: string[] }, n: number) => {
  await until(() => app.asks.length >= n);
  await new Promise((done) => setTimeout(done, 20));
};

test("a call ends at its reply; invalidate then shows the caller its write", async () => {
  const app = await boot();
  const tab = await app.client();
  const p1 = watchPart(tab, "p1");
  await opened(app, 1);
  const release = app.hold();

  await tab.run(api.add, { input: task("p1", "a") }); // the signal's ask is held: not in yet
  expect(p1.read()).toEqual([]);

  release();
  await tab.run(board.invalidate, { input: { tasks: { project: "p1" } } });
  expect(p1.read()).toEqual([task("p1", "a")]);
});

test("the server run reads the caller's id; each call has its own", async () => {
  const app = await boot();
  const tab = await app.client();

  const one = await tab.run(api.add, { input: task("p1", "a") });
  const two = await tab.run(api.add, { input: task("p1", "b") });

  expect(one).toMatch(/^[\w-]{8,}$/);
  expect(two).not.toBe(one);
});

test("an id that is not a plain id is not bound", async () => {
  const app = await boot();
  const said = await app.server.run(api.answer, {
    input: { address: "add", value: task("p1", "a"), meta: { execution: "a b" } },
  });

  expect(said).toEqual({ ok: true, value: "none" });
});

test("a fault carries the call's id as its ref, and the server logs the same id", async () => {
  const logs: Observe.Log[] = [];
  const broken = rpc({ boom: { input: z.null(), output: z.null() } });
  const boom = operation({
    label: "boom",
    input: z.null(),
    run: () => {
      throw new Error("no");
    },
  });
  const server = await createScope({
    observe: { log: (entry) => void logs.push(entry) },
    capsules: [broken({ implement: { boom } }), memory.server({ services: [broken] })],
  }).ready;
  closers.push(() => server.close());
  const tab = await createScope({
    capsules: [memory.client({ peer: server }), broken({ remote: memory.client })],
  }).ready;
  closers.push(() => tab.close());

  const fault = await tab.run(broken.boom, { input: null }).catch((e: unknown) => e);

  expect(broken.fault.is(fault)).toBe(true);
  const ref = (fault as { execution?: string }).execution;
  expect(ref).toMatch(/^[\w-]{8,}$/);
  const line = logs.find((l) => l.message === "rpc call failed");
  expect(line?.attributes.execution).toBe(ref);
});
