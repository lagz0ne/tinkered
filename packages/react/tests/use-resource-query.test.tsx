import type { Resource } from "@tinker/core";
import { createScope, resource } from "@tinker/core";
import { useState } from "react";
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

function Flags<T>({
  label,
  handle,
}: {
  label: string;
  handle: Resource.Handle<T>;
}): React.ReactElement {
  const q = useResource(handle, { suspense: false });
  const flags = [q.isPending, q.isSuccess, q.isError].map(Number).join("");
  return (
    <p>
      {label}:{flags}
    </p>
  );
}

test("a query reports its status through one flag at a time", async () => {
  const scope = createScope();
  const gate = deferred<number>();
  const slow = resource({ label: "slow-flags", factory: () => gate.promise });
  const fail = resource({ label: "fail-flags", factory: () => Promise.reject(new Error("nope")) });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Flags label="slow" handle={slow} />
      <Flags label="fail" handle={fail} />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("slow:100")).toBeVisible();
  await expect.element(screen.getByText("fail:001")).toBeVisible();
  gate.resolve(1);
  await expect.element(screen.getByText("slow:010")).toBeVisible();

  await scope.close();
});

test("a refetch drops the settled build: pending shows, never stale data", async () => {
  const scope = createScope();
  const gateA = deferred<number>();
  const gateB = deferred<number>();
  let build = 0;
  const raced = resource({
    label: "raced-query",
    factory: () => {
      build += 1;
      return build === 1 ? gateA.promise : gateB.promise;
    },
  });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Local handle={raced} />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("status:pending")).toBeVisible();
  gateA.resolve(1);
  await expect.element(screen.getByText("data:1")).toBeVisible();
  await screen.getByRole("button", { name: "refetch" }).click();
  await expect.element(screen.getByText("status:pending")).toBeVisible();
  await expect.element(screen.getByText("data:-")).toBeVisible();
  gateB.resolve(2);
  await expect.element(screen.getByText("data:2")).toBeVisible();

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

test("a refetch after switching handles rebuilds the current one fresh", async () => {
  const scope = createScope();
  let builds = 0;
  const mk = (label: string): Resource.Handle<Promise<number>> =>
    resource({ label, factory: () => Promise.resolve((builds += 1)) });
  const one = mk("rh-one");
  const two = mk("rh-two");

  function Switcher(): React.ReactElement {
    const [handle, setHandle] = useState(one);
    return (
      <div>
        <button type="button" onClick={() => setHandle(two)}>
          switch
        </button>
        <Local handle={handle} />
      </div>
    );
  }

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Switcher />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("data:1")).toBeVisible();
  await screen.getByRole("button", { name: "switch" }).click();
  await expect.element(screen.getByText("data:2")).toBeVisible();
  await screen.getByRole("button", { name: "refetch" }).click();
  await expect.element(screen.getByText("data:3")).toBeVisible();
  expect(builds).toBe(3);

  await scope.close();
});

test("a second refetch builds a third generation", async () => {
  const scope = createScope();
  let builds = 0;
  const counted = resource({
    label: "counted-refetch",
    factory: () => Promise.resolve((builds += 1)),
  });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Local handle={counted} />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("status:success")).toBeVisible();
  await expect.element(screen.getByText("data:1")).toBeVisible();
  await screen.getByRole("button", { name: "refetch" }).click();
  await expect.element(screen.getByText("data:2")).toBeVisible();
  await screen.getByRole("button", { name: "refetch" }).click();
  await expect.element(screen.getByText("data:3")).toBeVisible();
  expect(builds).toBe(3);

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
