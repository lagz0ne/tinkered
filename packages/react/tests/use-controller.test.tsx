import { createScope, data } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useController, useData } from "../src/index.ts";

const counter = data({ label: "counter", initial: 0 });

function Reader(): React.ReactElement {
  return <p>counter:{useData(counter)}</p>;
}

function Inc(): React.ReactElement {
  const control = useController(counter);
  return (
    <button type="button" onClick={() => control.update((n) => n + 1)}>
      inc
    </button>
  );
}

function Writer({ onRender }: { onRender: () => void }): React.ReactElement {
  useController(counter);
  onRender();
  return <span>writer</span>;
}

test("a controller write re-renders a separate reader", async () => {
  const scope = createScope();

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Inc />
      <Reader />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("counter:0")).toBeVisible();
  await screen.getByRole("button").click();
  await expect.element(screen.getByText("counter:1")).toBeVisible();

  await scope.close();
});

test("a write-only component does not subscribe to the cell it controls", async () => {
  const scope = createScope();
  let writerRenders = 0;

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Writer
        onRender={() => {
          writerRenders += 1;
        }}
      />
      <Reader />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("counter:0")).toBeVisible();
  const mounted = writerRenders;

  scope.controller(counter).set(7);
  await expect.element(screen.getByText("counter:7")).toBeVisible();

  expect(writerRenders).toBe(mounted);

  await scope.close();
});
