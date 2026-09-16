import { createScope, data } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useData } from "../src/index.ts";

const count = data({ label: "count", initial: 0 });

function Count(): React.ReactElement {
  return <p>count:{useData(count)}</p>;
}

test("reads a cell and re-renders when it is set externally", async () => {
  const scope = createScope();

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Count />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("count:0")).toBeVisible();
  scope.getController(count).set(5);
  await expect.element(screen.getByText("count:5")).toBeVisible();

  await scope.close();
});
