import { createScope, data } from "@tinker/core";
import { useState } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useData } from "../src/index.ts";

const count = data({ label: "count", initial: 0 });
const config = data({ label: "config", initial: { theme: "dark" } });
const word = data({ label: "word", initial: "a" });

function Count(): React.ReactElement {
  return <p>count:{useData(count)}</p>;
}

test("reading through a new scope shows the new scope's value", async () => {
  const scopeA = createScope();
  const scopeB = createScope();
  scopeA.controller(count).set(1);
  scopeB.controller(count).set(2);

  function Selected(): React.ReactElement {
    return <p>sel:{useData(count, (v) => v)}</p>;
  }

  function Switcher(): React.ReactElement {
    const [scope, setScope] = useState(scopeA);
    return (
      <button type="button" onClick={() => setScope(scopeB)}>
        <ScopeProvider scope={scope}>
          <Selected />
        </ScopeProvider>
      </button>
    );
  }

  const screen = await render(<Switcher />);

  await expect.element(screen.getByText("sel:1")).toBeVisible();
  await screen.getByRole("button").click();
  await expect.element(screen.getByText("sel:2")).toBeVisible();

  await scopeA.close();
  await scopeB.close();
});

test("reads a cell and re-renders when it is set externally", async () => {
  const scope = createScope();

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Count />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("count:0")).toBeVisible();
  scope.controller(count).set(5);
  await expect.element(screen.getByText("count:5")).toBeVisible();

  await scope.close();
});

test("an unchanged object value keeps its identity across a parent re-render", async () => {
  const scope = createScope();
  const seen: Array<{ theme: string }> = [];

  function Reader(): React.ReactElement {
    const value = useData(config);
    seen.push(value);
    return <p>theme:{value.theme}</p>;
  }

  function Parent(): React.ReactElement {
    const [n, setN] = useState(0);
    return (
      <button type="button" onClick={() => setN((x) => x + 1)}>
        bump {n}
        <Reader />
      </button>
    );
  }

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Parent />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("theme:dark")).toBeVisible();
  await screen.getByRole("button").click();
  await expect.element(screen.getByText("bump 1")).toBeVisible();

  expect(seen.length).toBeGreaterThan(1);
  expect(seen[seen.length - 1]).toBe(seen[0]);

  await scope.close();
});

test("a write after unmount neither updates the removed subtree nor breaks the still-open scope", async () => {
  const scope = createScope();

  function Reader(): React.ReactElement {
    return <p>read:{useData(word)}</p>;
  }

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Reader />
    </ScopeProvider>,
  );
  await expect.element(screen.getByText("read:a")).toBeVisible();
  await screen.unmount();

  scope.controller(word).set("b");

  const again = await render(
    <ScopeProvider scope={scope}>
      <Reader />
    </ScopeProvider>,
  );
  await expect.element(again.getByText("read:b")).toBeVisible();

  await scope.close();
});
