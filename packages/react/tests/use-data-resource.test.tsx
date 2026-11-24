import { createScope, data, resource, tag } from "@tinkered/core";
import { StrictMode, useState } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { ScopeProvider, useData } from "@/index";

type Pr = { viewer: string; id: string; amount: number };

const prs = data({
  label: "keyed.prs",
  mode: "keyed",
  key: (pr: Pr) => ({ viewer: pr.viewer, id: pr.id }),
});

const viewer = tag<string>({ label: "keyed.viewer" });

const runs = { count: 0 };

const total = resource({
  label: "keyed.total",
  config: { viewer: viewer.required },
  depends: (c) => ({ rows: prs.where({ viewer: c.viewer }) }),
  factory: ({ rows }) => {
    runs.count++;
    return { sum: rows.get().reduce((n, pr) => n + pr.amount, 0) };
  },
});

const seen = new Set<unknown>();

function Total(props: { viewer: string }): React.ReactElement {
  const view = useData(total({ viewer: props.viewer }));
  seen.add(view);
  return <p>{`${props.viewer}:${view.sum}`}</p>;
}

test("a component reads a keyed resource, keeps its reference across renders, and follows a write", async () => {
  const scope = createScope();
  const items = scope.controller(prs);
  items.set({ viewer: "a", id: "1", amount: 2 });
  let bump: () => void = () => undefined;
  function Parent(): React.ReactElement {
    const [n, setN] = useState(0);
    bump = () => setN(n + 1);
    return (
      <>
        <span>{`n${n}`}</span>
        <Total viewer="a" />
      </>
    );
  }
  const screen = await render(
    <ScopeProvider scope={scope}>
      <Parent />
    </ScopeProvider>,
  );
  await expect.element(screen.getByText("a:2")).toBeVisible();
  seen.clear();
  runs.count = 0;

  bump();
  await expect.element(screen.getByText("n1")).toBeVisible();
  const kept = seen.size;
  items.set({ viewer: "a", id: "2", amount: 5 });
  await expect.element(screen.getByText("a:7")).toBeVisible();

  expect(kept).toBe(1);
  expect(runs.count).toBe(1);
  await scope.close();
});

test("a new config leaves the old entry", async () => {
  const scope = createScope();
  scope.controller(prs).set({ viewer: "b", id: "3", amount: 9 });
  let pick: (to: string) => void = () => undefined;
  function Picker(): React.ReactElement {
    const [who, setWho] = useState("a");
    pick = setWho;
    return <Total viewer={who} />;
  }
  const screen = await render(
    <ScopeProvider scope={scope}>
      <Picker />
    </ScopeProvider>,
  );
  const first = scope.resolve(total({ viewer: "a" }));

  pick("b");
  await expect.element(screen.getByText("b:9")).toBeVisible();

  await expect.poll(() => scope.resolve(total({ viewer: "a" }))).not.toBe(first);
  await scope.close();
});

test("under StrictMode, a keyed resource read builds its entry once", async () => {
  const scope = createScope();
  scope.controller(prs).set({ viewer: "c", id: "4", amount: 3 });
  runs.count = 0;

  const screen = await render(
    <StrictMode>
      <ScopeProvider scope={scope}>
        <Total viewer="c" />
      </ScopeProvider>
    </StrictMode>,
  );
  await expect.element(screen.getByText("c:3")).toBeVisible();

  expect(runs.count).toBe(1);
  await scope.close();
});
