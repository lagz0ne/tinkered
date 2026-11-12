import { createScope, data } from "@tinkered/core";
import { useState } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { ScopeProvider, useData } from "@/index";

type Task = { project: string; id: string; title: string };

const tasks = data({
  label: "task.items",
  mode: "keyed",
  key: (t: Task) => ({ project: t.project, id: t.id }),
});

const task = (project: string, id: string, title = id): Task => ({ project, id, title });

const renders: Record<string, number> = {};

function Panel(props: { project: string }): React.ReactElement {
  const list = useData(tasks.where({ project: props.project }));
  renders[props.project] = (renders[props.project] ?? 0) + 1;
  return <p>{`${props.project}:${list.map((t) => t.title).join()}`}</p>;
}

test("a write to one part renders only the panel of that part", async () => {
  const scope = createScope();
  const items = scope.controller(tasks);
  items.set(task("p1", "a"));
  items.set(task("p2", "b"));
  const screen = await render(
    <ScopeProvider scope={scope}>
      <Panel project="p1" />
      <Panel project="p2" />
    </ScopeProvider>,
  );
  await expect.element(screen.getByText("p2:b")).toBeVisible();
  const before = { ...renders };

  items.set(task("p1", "c"));
  await expect.element(screen.getByText("p1:a,c")).toBeVisible();

  expect(renders.p2).toBe(before.p2);
  expect(renders.p1).toBe((before.p1 ?? 0) + 1);
  await scope.close();
});

test("a member read by key renders its own row", async () => {
  const scope = createScope();
  scope.controller(tasks).set(task("p1", "a"));
  function Row(): React.ReactElement {
    return <p>{`row:${useData(tasks.of({ project: "p1", id: "a" }))?.title ?? "none"}`}</p>;
  }
  const screen = await render(
    <ScopeProvider scope={scope}>
      <Row />
    </ScopeProvider>,
  );

  scope.controller(tasks).delete({ project: "p1", id: "a" });

  await expect.element(screen.getByText("row:none")).toBeVisible();
  await scope.close();
});

test("a panel that changes its part 1,000 times leaves each old part", async () => {
  const scope = createScope();
  const items = scope.controller(tasks);
  let move: (to: number) => void = () => undefined;
  function Moving(): React.ReactElement {
    const [at, setAt] = useState(0);
    move = setAt;
    return <Panel project={`k${at}`} />;
  }
  const screen = await render(
    <ScopeProvider scope={scope}>
      <Moving />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("k0:")).toBeVisible();
  const kept = items.where({ project: "k0" });

  for (let at = 1; at <= 1000; at++) {
    move(at);
    await expect.element(screen.getByText(`k${at}:`)).toBeVisible();
  }
  const rendered = renders.k1000;
  items.set(task("k0", "late"));

  expect(items.where({ project: "k0" })).not.toBe(kept);
  expect(renders.k1000).toBe(rendered);
  await scope.close();
});
