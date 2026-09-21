import { createScope } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, isError, useScope } from "../src/index.ts";
import { Catch } from "./support/boundary.tsx";

function Orphan(): React.ReactElement {
  useScope();
  return <p>has-scope</p>;
}

function Probe({ value }: { value: unknown }): React.ReactElement {
  return <p>match:{String(isError(value, "NoProvider"))}</p>;
}

test("isError matches a NoProvider error from this package", async () => {
  let captured: unknown;
  const boundary = await render(
    <Catch
      fallback={(error) => {
        captured = error;
        return <p>caught</p>;
      }}
    >
      <Orphan />
    </Catch>,
  );
  await expect.element(boundary.getByText("caught")).toBeVisible();

  const scope = createScope();
  const check = await render(
    <ScopeProvider scope={scope}>
      <Probe value={captured} />
    </ScopeProvider>,
  );
  await expect.element(check.getByText("match:true")).toBeVisible();
  await scope.close();
});

test("isError rejects a plain error without the asked kind", async () => {
  const scope = createScope();
  const screen = await render(
    <ScopeProvider scope={scope}>
      <Probe value={new Error("plain")} />
    </ScopeProvider>,
  );
  await expect.element(screen.getByText("match:false")).toBeVisible();
  await scope.close();
});

test("isError rejects values that are not errors", async () => {
  const scope = createScope();
  const screen = await render(
    <ScopeProvider scope={scope}>
      <Probe value={null} />
    </ScopeProvider>,
  );
  await expect.element(screen.getByText("match:false")).toBeVisible();
  await scope.close();
});
