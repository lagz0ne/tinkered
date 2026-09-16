import { createScope, operation, resource } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useResolve, useResource, useSpans } from "../src/index.ts";

const res = resource({ label: "res", factory: () => ({ ok: true }) });
const op = operation({ label: "op", run: () => 1 });

function Inspector(): React.ReactElement {
  const run = useResolve(op);
  useResource(res);
  const spans = useSpans();
  const names = spans.map((span) => span.name);
  return (
    <div>
      <button type="button" onClick={() => run.resolve()}>
        go
      </button>
      <p>status:{run.status}</p>
      <p>count:{spans.length}</p>
      <p>hasRes:{String(names.includes("res"))}</p>
      <p>hasOp:{String(names.includes("op"))}</p>
    </div>
  );
}

test("useSpans surfaces spans from resolved work when observation is on", async () => {
  const scope = createScope({ observe: { history: 100 } });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Inspector />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("hasRes:true")).toBeVisible();
  await expect.element(screen.getByText("hasOp:false")).toBeVisible();

  await screen.getByRole("button", { name: "go" }).click();
  await expect.element(screen.getByText("hasOp:true")).toBeVisible();

  await scope.close();
});

test("with observation off, useSpans is empty even after work", async () => {
  const scope = createScope();

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Inspector />
    </ScopeProvider>,
  );

  await screen.getByRole("button", { name: "go" }).click();
  await expect.element(screen.getByText("status:success")).toBeVisible();

  await expect.element(screen.getByText("count:0")).toBeVisible();
  await expect.element(screen.getByText("hasRes:false")).toBeVisible();

  await scope.close();
});
