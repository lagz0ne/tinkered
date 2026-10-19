import { expect, test } from "vite-plus/test";

import { createScope, data, namespace } from "@/index";

test("a grandchild watcher beside unwatched sessions sees a root write", async () => {
  const cell = data({ label: "deep-watch", initial: 0 });
  const root = createScope();
  await root.ready;
  for (let i = 0; i < 3; i++) root.createSession().createSession();
  const grandchild = root.createSession().createSession();
  const seen: number[] = [];
  grandchild.controller(cell).watch((next) => seen.push(next));

  root.controller(cell).set(5);

  expect(seen).toEqual([5]);
  await root.close({ graceful: true });
});

test("a watcher under an already watched root still sees a root write", async () => {
  const cell = data({ label: "late-deep-watch", initial: 0 });
  const root = createScope();
  await root.ready;
  const seen: string[] = [];
  root.controller(cell).watch((next) => seen.push(`root ${next}`));
  const grandchild = root.createSession().createSession();
  grandchild.controller(cell).watch((next) => seen.push(`grandchild ${next}`));

  root.controller(cell).set(5);

  expect(seen).toEqual(["root 5", "grandchild 5"]);
  await root.close({ graceful: true });
});

test("a session that dropped its watcher can watch again", async () => {
  const cell = data({ label: "rewatch", initial: 0 });
  const root = createScope();
  await root.ready;
  const child = root.createSession();
  const seen: number[] = [];
  const stop = child.controller(cell).watch(() => undefined);
  stop();
  root.controller(cell).set(1);

  child.controller(cell).watch((next) => seen.push(next));
  root.controller(cell).set(2);

  expect(seen).toEqual([2]);
  await root.close({ graceful: true });
});

test("a grandchild named watcher sees a root default write it falls back to", async () => {
  const a = namespace();
  const cell = data({ label: "named-fallback-watch", initial: 0 });
  const root = createScope();
  await root.ready;
  root.createSession();
  const grandchild = root.createSession().createSession();
  const seen: number[] = [];
  grandchild.controller(cell, { ns: a }).watch((next) => seen.push(next));

  root.controller(cell).set(5);

  expect(seen).toEqual([5]);
  await root.close({ graceful: true });
});
