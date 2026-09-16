import { createScope, data } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, isError, useScope } from "../src/index.ts";
import { Catch } from "./support/boundary.tsx";

const greeting = data({ label: "greeting", initial: "hi" });

function Greeting(): React.ReactElement {
  const scope = useScope();
  return <p>{scope.getController(greeting).get()}</p>;
}

test("provides an app-owned scope that hooks resolve against", async () => {
  const scope = createScope();

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Greeting />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("hi")).toBeVisible();
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

function label(error: unknown): string {
  return isError(error, "NoProvider") ? `caught:${error.payload.hook}` : "other";
}

test("a hook used with no provider raises NoProvider", async () => {
  const screen = await render(
    <Catch fallback={(error) => <p>{label(error)}</p>}>
      <Greeting />
    </Catch>,
  );

  await expect.element(screen.getByText("caught:useScope")).toBeVisible();
});
