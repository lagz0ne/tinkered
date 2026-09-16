import type { Resource } from "@tinker/core";
import { createScope, resource } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useResource } from "../src/index.ts";
import { Catch } from "./support/boundary.tsx";
import { deferred } from "./support/deferred.ts";

function Local<T>({ handle }: { handle: Resource.Handle<T> }): React.ReactElement {
  const q = useResource(handle, { suspense: false });
  return (
    <div>
      <button type="button" onClick={() => q.refetch()}>
        refetch
      </button>
      <p>status:{q.status}</p>
      <p>data:{q.status === "success" ? String(q.data) : "-"}</p>
      <p>error:{q.status === "error" ? String(q.error) : "-"}</p>
    </div>
  );
}

test("suspense:false renders pending then success without a Suspense boundary", async () => {
  const scope = createScope();
  const gate = deferred<number>();
  const slow = resource({ label: "slow", factory: () => gate.promise });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Local handle={slow} />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("status:pending")).toBeVisible();
  gate.resolve(42);
  await expect.element(screen.getByText("status:success")).toBeVisible();
  await expect.element(screen.getByText("data:42")).toBeVisible();

  await scope.close();
});

test("suspense:false reports a synchronous build as success at once", async () => {
  const scope = createScope();
  const quick = resource({ label: "quick", factory: () => 7 });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Local handle={quick} />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("status:success")).toBeVisible();
  await expect.element(screen.getByText("data:7")).toBeVisible();

  await scope.close();
});

test("suspense:false keeps a failed build in error (no boundary) and refetch builds a fresh generation", async () => {
  const scope = createScope();
  let builds = 0;
  const flaky = resource({
    label: "flaky",
    factory: () => {
      builds += 1;
      return builds === 1 ? Promise.reject(new Error("first-fail")) : Promise.resolve(builds);
    },
  });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Catch fallback={() => <p>boundary</p>}>
        <Local handle={flaky} />
      </Catch>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("status:error")).toBeVisible();
  await expect.element(screen.getByText("error:Error: first-fail")).toBeVisible();
  await expect.element(screen.getByText("boundary")).not.toBeInTheDocument();

  await screen.getByRole("button", { name: "refetch" }).click();
  await expect.element(screen.getByText("status:success")).toBeVisible();
  await expect.element(screen.getByText("data:2")).toBeVisible();
  expect(builds).toBe(2);

  await scope.close();
});
