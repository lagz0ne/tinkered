import { createScope, operation, resource } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useResolve, useResource, useSpans } from "../src/index.ts";

const res = resource({ label: "res", factory: () => ({ ok: true }) });
const op = operation({ label: "op", run: () => 1 });

function Worker(): React.ReactElement {
  const run = useResolve(op);
  const built = useResource(res);
  const spans = useSpans();
  const names = spans.map((span) => span.name);
  const marker = spans.find((span) => span.name === "react.resource");
  return (
    <div>
      <button type="button" onClick={() => void run.resolve()}>
        go
      </button>
      <p>status:{run.status}</p>
      <p>ok:{String(built.ok)}</p>
      <p>data:{run.status === "success" ? String(run.data) : "-"}</p>
      <p>marked:{marker ? String(marker.attributes.resource) : "-"}</p>
      <p>hasReactResource:{String(names.includes("react.resource"))}</p>
      <p>hasReactResolve:{String(names.includes("react.resolve"))}</p>
    </div>
  );
}

test("with emission on, react.resource + react.resolve spans appear, tagged with the work label", async () => {
  const scope = createScope({ observe: { history: 100 } });

  const screen = await render(
    <ScopeProvider scope={scope} emit>
      <Worker />
    </ScopeProvider>,
  );

  await screen.getByRole("button", { name: "go" }).click();
  await expect.element(screen.getByText("status:success")).toBeVisible();
  await expect.element(screen.getByText("ok:true")).toBeVisible();
  await expect.element(screen.getByText("data:1")).toBeVisible();
  await expect.element(screen.getByText("hasReactResource:true")).toBeVisible();
  await expect.element(screen.getByText("hasReactResolve:true")).toBeVisible();
  await expect.element(screen.getByText("marked:res")).toBeVisible();

  await scope.close();
});

test("with emission off, no react.* spans appear and the results are identical", async () => {
  const scope = createScope({ observe: { history: 100 } });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Worker />
    </ScopeProvider>,
  );

  await screen.getByRole("button", { name: "go" }).click();
  await expect.element(screen.getByText("status:success")).toBeVisible();
  await expect.element(screen.getByText("ok:true")).toBeVisible();
  await expect.element(screen.getByText("data:1")).toBeVisible();
  await expect.element(screen.getByText("hasReactResource:false")).toBeVisible();
  await expect.element(screen.getByText("hasReactResolve:false")).toBeVisible();

  await scope.close();
});
