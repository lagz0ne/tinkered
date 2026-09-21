import type { Resource } from "@tinker/core";
import { createScope, data, resource } from "@tinker/core";
import { Suspense, useState } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useController, useData, useRelease, useResource } from "../src/index.ts";
import { Catch } from "./support/boundary.tsx";
import { deferred } from "./support/deferred.ts";

type Boxed = { v: number };

function Show({ handle }: { handle: Resource.Handle<Promise<Boxed>> }): React.ReactElement {
  return <p>v:{useResource(handle).v}</p>;
}

function Retryable({ handle }: { handle: Resource.Handle<Promise<Boxed>> }): React.ReactElement {
  const release = useRelease();
  return (
    <Catch
      fallback={(_error, reset) => (
        <button
          type="button"
          onClick={() => {
            release(handle);
            reset();
          }}
        >
          retry
        </button>
      )}
    >
      <Suspense fallback={<p>loading</p>}>
        <Show handle={handle} />
      </Suspense>
    </Catch>
  );
}

const cell = data({ label: "cell", initial: "start" });

function CellView(): React.ReactElement {
  const value = useData(cell);
  const control = useController(cell);
  const release = useRelease();
  return (
    <div>
      <p>v:{value}</p>
      <button type="button" onClick={() => control.set("changed")}>
        set
      </button>
      <button type="button" onClick={() => release(cell)}>
        rel
      </button>
    </div>
  );
}

test("retry: releasing a failed resource + resetting the boundary rebuilds it green", async () => {
  const scope = createScope();
  let attempt = 0;
  const gate = deferred<Boxed>();
  const flaky = resource({
    label: "flaky",
    factory: () => {
      attempt += 1;
      return attempt === 1 ? gate.promise : Promise.resolve({ v: 42 });
    },
  });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Retryable handle={flaky} />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("loading")).toBeVisible();
  gate.reject(new Error("first-fail"));
  await expect.element(screen.getByRole("button", { name: "retry" })).toBeVisible();

  await screen.getByRole("button", { name: "retry" }).click();
  await expect.element(screen.getByText("v:42")).toBeVisible();

  await scope.close();
});

test("releasing through a new scope reverts the new scope's cell", async () => {
  const scopeA = createScope();
  const scopeB = createScope();
  const flag = data({ label: "flag", initial: "start" });
  scopeA.controller(flag).set("aaa");
  scopeB.controller(flag).set("bbb");

  function Switcher(): React.ReactElement {
    const [scope, setScope] = useState(scopeA);
    return (
      <ScopeProvider scope={scope}>
        <button type="button" onClick={() => setScope(scopeB)}>
          switch
        </button>
        <Inner />
      </ScopeProvider>
    );
  }

  function Inner(): React.ReactElement {
    const release = useRelease();
    return (
      <div>
        <button type="button" onClick={() => release(flag)}>
          rel
        </button>
        <p>flag:{useData(flag)}</p>
      </div>
    );
  }

  const screen = await render(<Switcher />);

  await expect.element(screen.getByText("flag:aaa")).toBeVisible();
  await screen.getByRole("button", { name: "switch" }).click();
  await expect.element(screen.getByText("flag:bbb")).toBeVisible();
  await screen.getByRole("button", { name: "rel" }).click();
  await expect.element(screen.getByText("flag:start")).toBeVisible();
  expect(scopeA.controller(flag).get()).toBe("aaa");

  await scopeA.close();
  await scopeB.close();
});

test("releasing a data cell reverts it to its initial value and notifies readers", async () => {
  const scope = createScope();

  const screen = await render(
    <ScopeProvider scope={scope}>
      <CellView />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("v:start")).toBeVisible();
  await screen.getByRole("button", { name: "set" }).click();
  await expect.element(screen.getByText("v:changed")).toBeVisible();

  await screen.getByRole("button", { name: "rel" }).click();
  await expect.element(screen.getByText("v:start")).toBeVisible();

  await scope.close();
});
