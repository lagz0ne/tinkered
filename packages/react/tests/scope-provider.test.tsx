import { createScope, data } from "@tinker/core";
import { StrictMode } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, isError, useScope } from "../src/index.ts";
import { Catch } from "./support/boundary.tsx";

const greeting = data({ label: "greeting", initial: "hi" });

function Greeting(): React.ReactElement {
  const scope = useScope();
  return <p>{scope.getController(greeting).get()}</p>;
}

test("uses the exact app-owned scope and never closes it", async () => {
  const scope = createScope();
  scope.getController(greeting).set("seeded");

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Greeting />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("seeded")).toBeVisible();
  await screen.unmount();

  expect(scope.getController(greeting).get()).toBe("seeded");
  await scope.close();
});

test("create mode closes the owned scope exactly once on unmount", async () => {
  let closes = 0;
  const create = () => {
    const scope = createScope();
    scope.onClose(() => {
      closes += 1;
    });
    return scope;
  };

  const screen = await render(
    <ScopeProvider create={create}>
      <Greeting />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("hi")).toBeVisible();
  await screen.unmount();
  await expect.poll(() => closes).toBe(1);
});

test("under StrictMode, create mode leaks no scope and never exposes a closed one", async () => {
  let creates = 0;
  let closes = 0;
  const create = () => {
    creates += 1;
    const scope = createScope();
    scope.onClose(() => {
      closes += 1;
    });
    return scope;
  };

  const screen = await render(
    <StrictMode>
      <ScopeProvider create={create}>
        <Greeting />
      </ScopeProvider>
    </StrictMode>,
  );

  await expect.element(screen.getByText("hi")).toBeVisible();
  await screen.unmount();
  await expect.poll(() => creates > 0 && creates === closes).toBe(true);
});

function label(error: unknown): string {
  if (!isError(error, "NoProvider")) throw error;
  return `caught:${error.payload.hook}`;
}

test("a hook used with no provider raises NoProvider", async () => {
  const screen = await render(
    <Catch fallback={(error) => <p>{label(error)}</p>}>
      <Greeting />
    </Catch>,
  );

  await expect.element(screen.getByText("caught:useScope")).toBeVisible();
});
