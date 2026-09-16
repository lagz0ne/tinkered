import type { Data } from "@tinker/core";
import { createScope, data } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useData } from "../src/index.ts";

function Counter({ cell }: { cell: Data.Cell<number> }): React.ReactElement {
  const [count, setCount] = useData(cell, { writable: true });
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      count:{count}
    </button>
  );
}

function Doubled({ cell }: { cell: Data.Cell<number> }): React.ReactElement {
  const [twice, set] = useData(cell, (n) => n * 2, { writable: true });
  return (
    <button type="button" onClick={() => set(10)}>
      twice:{twice}
    </button>
  );
}

test("useData with writable returns the value and a setter that writes the cell", async () => {
  const scope = createScope();
  const count = data({ label: "count", initial: 1 });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Counter cell={count} />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("count:1")).toBeVisible();
  await screen.getByRole("button").click();
  await expect.element(screen.getByText("count:2")).toBeVisible();
  expect(scope.getController(count).get()).toBe(2);

  await scope.close();
});

test("useData with a selector and writable returns the slice and a setter for the whole cell", async () => {
  const scope = createScope();
  const count = data({ label: "count", initial: 3 });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Doubled cell={count} />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("twice:6")).toBeVisible();
  await screen.getByRole("button").click();
  await expect.element(screen.getByText("twice:20")).toBeVisible();
  expect(scope.getController(count).get()).toBe(10);

  await scope.close();
});

test("the writable setter keeps its identity across a cell update", async () => {
  const scope = createScope();
  const count = data({ label: "stable-set", initial: 0 });
  const seen: Array<(value: number) => void> = [];

  function Stable(): React.ReactElement {
    const [value, set] = useData(count, { writable: true });
    seen.push(set);
    return <p>stable:{value}</p>;
  }

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Stable />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("stable:0")).toBeVisible();
  scope.getController(count).set(1);
  await expect.element(screen.getByText("stable:1")).toBeVisible();

  expect(seen.length).toBeGreaterThan(1);
  expect(seen[seen.length - 1]).toBe(seen[0]);

  await scope.close();
});
