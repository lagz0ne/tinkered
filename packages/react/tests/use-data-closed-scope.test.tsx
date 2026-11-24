import { createScope, data } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { useLayoutEffect } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { ScopeProvider, useData } from "@/index";

/** A plain cell, not a keyed one: a keyed cell's read gives a new array at close with no write,
 * so React renders the reader again, and that render raises `Disposed` (ADR 0144 d3). */
const count = data({ label: "closed.count", initial: 1 });

function Count(): React.ReactElement {
  return <p>{`count:${useData(count)}`}</p>;
}

function Doubled(): React.ReactElement {
  return <p>{`doubled:${useData(count, (n) => n * 2)}`}</p>;
}

type Task = { project: string; id: string };

const tasks = data({
  label: "closed.tasks",
  mode: "keyed",
  key: (t: Task) => ({ project: t.project, id: t.id }),
});

function Panel(props: { project: string }): React.ReactElement {
  const list = useData(tasks.where({ project: props.project }));
  return <p>{`${props.project}:${list.map((t) => t.id).join()}`}</p>;
}

/** Collects each error that reaches the page, as React reports an uncaught render error, and
 * keeps it from failing the run. `stop` removes the listener. */
function collectPageErrors(): { errors: unknown[]; stop: () => void } {
  const errors: unknown[] = [];
  const receive = (event: ErrorEvent): void => {
    errors.push(event.error);
    event.preventDefault();
  };
  window.addEventListener("error", receive, true);
  return { errors, stop: () => window.removeEventListener("error", receive, true) };
}

/** A sibling that closes `scope` in its layout effect: after React commits, before the passive
 * effects where `useData` subscribes. `closing` receives the close. */
function closerOf(scope: Scope.Handle, closing: Promise<Scope.Result>[]): () => null {
  return function Closer(): null {
    useLayoutEffect(() => {
      closing.push(scope.close({ graceful: true }));
    }, []);
    return null;
  };
}

test("a scope that closes before useData subscribes reports no error", async () => {
  const scope = createScope();
  const page = collectPageErrors();
  const closing: Promise<Scope.Result>[] = [];
  const Closer = closerOf(scope, closing);

  try {
    const screen = await render(
      <ScopeProvider scope={scope}>
        <Count />
        <Doubled />
        <Closer />
      </ScopeProvider>,
    );
    await expect.element(screen.getByText("count:1")).toBeVisible();
    await expect.element(screen.getByText("doubled:2")).toBeVisible();
  } finally {
    page.stop();
  }

  expect(page.errors).toEqual([]);
  expect((await closing[0])?.status).toBe("success");
});

test("useData keeps each written value when the scope closes before it subscribes", async () => {
  const scope = createScope();
  scope.controller(count).set(2);
  scope.controller(tasks).set({ project: "p1", id: "a" });
  const page = collectPageErrors();
  const closing: Promise<Scope.Result>[] = [];
  const Closer = closerOf(scope, closing);

  try {
    const screen = await render(
      <ScopeProvider scope={scope}>
        <Count />
        <Doubled />
        <Panel project="p1" />
        <Closer />
      </ScopeProvider>,
    );
    await expect.element(screen.getByText("count:2")).toBeVisible();
    await expect.element(screen.getByText("doubled:4")).toBeVisible();
    await expect.element(screen.getByText("p1:a")).toBeVisible();
  } finally {
    page.stop();
  }

  expect(page.errors).toEqual([]);
  expect((await closing[0])?.status).toBe("success");
});

test("a where read keeps its value when its keyed cell already has a watcher at the close", async () => {
  const scope = createScope();
  scope.controller(tasks).set({ project: "p1", id: "a" });
  scope.controller(tasks).set({ project: "p2", id: "b" });
  const page = collectPageErrors();
  const closing: Promise<Scope.Result>[] = [];
  const Closer = closerOf(scope, closing);

  try {
    const screen = await render(
      <ScopeProvider scope={scope}>
        <Panel project="p1" />
      </ScopeProvider>,
    );
    await screen.rerender(
      <ScopeProvider scope={scope}>
        <Panel project="p1" />
        <Panel project="p2" />
        <Closer />
      </ScopeProvider>,
    );
    await expect.element(screen.getByText("p1:a")).toBeVisible();
    await expect.element(screen.getByText("p2:b")).toBeVisible();
  } finally {
    page.stop();
  }

  expect(page.errors).toEqual([]);
  expect((await closing[0])?.status).toBe("success");
});
