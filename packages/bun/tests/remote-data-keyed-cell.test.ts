import { createScope, data, operation, remoteData, transport } from "@tinker/core";
import type { Scope } from "@tinker/core";
import { memory } from "@tinker/core/testing";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { z } from "zod";

import { listen, wsClient, wsServer } from "./support";

const { hook } = transport;

// A served keyed cell (ADR 0137) on both transports: the first reader of a part asks for it.

type Task = { project: string; id: string; title: string };

const Task = z.object({ project: z.string(), id: z.string(), title: z.string() });

const tasks = data({
  label: "task.items",
  mode: "keyed",
  parse: Task,
  key: (t) => ({ project: t.project, id: t.id }),
});

const board = remoteData({ tasks });

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

/** A server with two projects, on one transport. `seen` lists each call's address and input. */
async function boot(kind: "memory" | "ws", options: { refuse?: string } = {}) {
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

  const wire = wsServer.server({ path: "/api", services: [board] });
  const server = await createScope({
    capsules: [
      board({ serve: true, onStart: [guard], onFinish: [finished] }),
      wire,
      memory.server({ services: [board] }),
    ],
  }).ready;
  closers.push(() => server.close());
  await server.run(add, { input: task("p1", "a") });
  await server.run(add, { input: task("p2", "b") });

  let base = "";
  if (kind === "ws") {
    const { bun, url } = listen(server, [wire]);
    closers.push(() => bun.stop(true));
    base = `${url}/api`;
  }

  const client = async () => {
    const link =
      kind === "memory" ? memory.client({ peer: server }) : wsClient.client({ url: base });
    const read = kind === "memory" ? memory.client : wsClient.client;
    const scope = await createScope({ capsules: [link, board({ read })] }).ready;
    closers.push(() => scope.close());
    return scope;
  };
  return { server, client, seen, ended };
}

/** A client's reader of a part, kept in use until `stop`. */
const watchPart = (scope: Scope.Handle, project: string) => {
  const reader = scope.resolve(board.tasks.where({ project }));
  return { read: () => reader.get(), stop: reader.watch(() => undefined) };
};

const all = (scope: Scope.Handle) => scope.resolve(board.tasks).get();

for (const kind of ["memory", "ws"] as const) {
  describe(kind, () => {
    test("two clients read two parts and each gets only its members", async () => {
      const app = await boot(kind);
      const [a, b] = await Promise.all([app.client(), app.client()]);

      const p1 = watchPart(a, "p1");
      const p2 = watchPart(b, "p2");
      await until(() => p1.read().length > 0 && p2.read().length > 0);

      expect(all(a)).toEqual([task("p1", "a")]);
      expect(all(b)).toEqual([task("p2", "b")]);
    });

    test("the guard gets the part at each ask and can refuse it", async () => {
      const app = await boot(kind, { refuse: "p2" });
      const tab = await app.client();

      const p1 = watchPart(tab, "p1");
      watchPart(tab, "p2");
      const p2 = tab.resolve(board.status(board.tasks.where({ project: "p2" })));
      await until(() => p1.read().length > 0 && p2.get()?.status === "fault");

      expect(p2.get()).toMatchObject({ status: "fault", fault: { fault: "refused" } });
      expect(app.seen).toContainEqual({
        key: "tasks.ask",
        input: { read: "where", part: { project: "p1" } },
      });
      expect(all(tab)).toEqual([task("p1", "a")]);
    });

    test("a client whose link drops asks again", async () => {
      const app = await boot(kind);
      const tab = await app.client();
      const p1 = watchPart(tab, "p1");
      await until(() => p1.read().length > 0);
      const asks = () => app.seen.filter((s) => s.key === "tasks.ask").length;
      const before = asks();

      await app.server.run(board.drop);
      await until(() => asks() > before);

      expect(p1.read()).toEqual([task("p1", "a")]);
    });

    test("after the last reader leaves, the stream ends and the client's part goes", async () => {
      const app = await boot(kind);
      const tab = await app.client();
      const p1 = watchPart(tab, "p1");
      await until(() => p1.read().length > 0);

      p1.stop();
      await until(() => app.ended.includes("tasks"));

      expect(all(tab)).toEqual([]);
    });
  });
}
