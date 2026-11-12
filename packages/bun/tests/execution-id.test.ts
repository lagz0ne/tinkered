import { createScope, data, execution, operation, remoteData, rpc } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { memory } from "@tinkered/core/testing";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { z } from "zod";

import { listen, wsClient, wsServer } from "./support";

// The execution id (ADR 0147) on both transports: the server reads the caller's id; a call ends
// at its reply, and `board.invalidate` shows the caller its own write.

type Task = { project: string; id: string; title: string };

const Task = z.object({ project: z.string(), id: z.string(), title: z.string() });

const tasks = data({
  label: "task.items",
  mode: "keyed",
  parse: Task,
  key: (t) => ({ project: t.project, id: t.id }),
});

const board = remoteData({ tasks });

const api = rpc({ add: { input: Task, output: z.string() } });

const task = (project: string, id: string): Task => ({ project, id, title: id });

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function boot(kind: "memory" | "ws") {
  const add = operation({
    label: "add",
    input: Task,
    depends: { items: tasks.controller, id: execution.required },
    run: ({ items, id }, { input }) => (items.set(input), id),
  });
  const wire = wsServer.server({ path: "/api", services: [board, api] });
  const server = await createScope({
    capsules: [
      board({ serve: true }),
      api({ implement: { add } }),
      wire,
      memory.server({ services: [board, api] }),
    ],
  }).ready;
  closers.push(() => server.close());

  let base = "";
  if (kind === "ws") {
    const { bun, url } = listen(server, [wire]);
    closers.push(() => bun.stop(true));
    base = `${url}/api`;
  }

  const link = kind === "memory" ? memory.client({ peer: server }) : wsClient.client({ url: base });
  const remote = kind === "memory" ? memory.client : wsClient.client;
  const tab = await createScope({
    capsules: [link, board({ read: remote }), api({ remote })],
  }).ready;
  closers.push(() => tab.close());
  return tab;
}

const watchPart = (scope: Scope.Handle, project: string) => {
  const reader = scope.resolve(board.tasks.where({ project }));
  return { read: () => reader.get(), stop: reader.watch(() => undefined) };
};

for (const kind of ["memory", "ws"] as const) {
  describe(kind, () => {
    test("each call carries its own id; invalidate then shows the write", async () => {
      const tab = await boot(kind);
      const p1 = watchPart(tab, "p1");
      const ids = new Set<string>();

      for (const id of ["a", "b", "c"]) {
        ids.add(await tab.run(api.add, { input: task("p1", id) }));
        await tab.run(board.invalidate, { input: { tasks: { project: "p1" } } });
        expect(p1.read().at(-1)).toEqual(task("p1", id));
      }
      expect(ids.size).toBe(3);
    });
  });
}
