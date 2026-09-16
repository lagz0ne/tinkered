import { createScope, resource } from "@tinker/core";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useResource } from "../src/index.ts";

const store = resource({
  label: "store",
  factory: () => ({ value: 42 }),
});

function Show(): React.ReactElement {
  const built = useResource(store);
  return <p>value:{built.value}</p>;
}

let captured: { value: number } | undefined;

function Capture(): React.ReactElement {
  captured = useResource(store);
  return <p>ok</p>;
}

test("builds synchronously: the value commits on the first flushed render, no suspend", async () => {
  const scope = createScope();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  flushSync(() => {
    root.render(
      <ScopeProvider scope={scope}>
        <Show />
      </ScopeProvider>,
    );
  });

  expect(container.textContent).toContain("value:42");

  root.unmount();
  container.remove();
  await scope.close();
});

test("returns the exact instance core cached for the owner", async () => {
  const scope = createScope();
  const built = scope.getController(store).resolve();

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Capture />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("ok")).toBeVisible();
  expect(captured).toBe(built);

  await scope.close();
});
