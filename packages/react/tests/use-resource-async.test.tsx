import type { Resource } from "@tinker/core";
import { createScope, resource } from "@tinker/core";
import { Suspense, useState } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useResource } from "../src/index.ts";
import { deferred } from "./support/deferred.ts";

type Named = { name: string };
type Numbered = { n: number };

function ShowName({ handle }: { handle: Resource.Handle<Promise<Named>> }): React.ReactElement {
  return <p>name:{useResource(handle).name}</p>;
}

function ShowN({ handle }: { handle: Resource.Handle<Promise<Numbered>> }): React.ReactElement {
  return <p>n:{useResource(handle).n}</p>;
}

function BumpParent({
  handle,
}: {
  handle: Resource.Handle<Promise<Numbered>>;
}): React.ReactElement {
  const [x, setX] = useState(0);
  return (
    <div>
      <button type="button" onClick={() => setX((v) => v + 1)}>
        bump {x}
      </button>
      <Suspense fallback={<p>loading</p>}>
        <ShowN handle={handle} />
      </Suspense>
    </div>
  );
}

test("suspends on an async build: shows the fallback, then the value once it settles", async () => {
  const scope = createScope();
  const gate = deferred<Named>();
  const profile = resource({ label: "profile", factory: () => gate.promise });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Suspense fallback={<p>loading</p>}>
        <ShowName handle={profile} />
      </Suspense>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("loading")).toBeVisible();
  gate.resolve({ name: "ada" });
  await expect.element(screen.getByText("name:ada")).toBeVisible();

  await scope.close();
});

test("a re-render while pending reuses one build: the factory runs once and Suspense still resolves", async () => {
  const scope = createScope();
  const gate = deferred<Numbered>();
  let builds = 0;
  const once = resource({
    label: "once",
    factory: () => {
      builds += 1;
      return gate.promise;
    },
  });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <BumpParent handle={once} />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("loading")).toBeVisible();
  await screen.getByRole("button").click();
  await expect.element(screen.getByText("bump 1")).toBeVisible();

  gate.resolve({ n: 7 });
  await expect.element(screen.getByText("n:7")).toBeVisible();
  expect(builds).toBe(1);

  await scope.close();
});

test("resolve() hands back one stable promise per owner — while pending and after settle", async () => {
  const scope = createScope();
  const gate = deferred<Numbered>();
  const stable = resource({ label: "stable", factory: () => gate.promise });

  const first = scope.controller(stable).resolve();
  const whilePending = scope.controller(stable).resolve();
  expect(whilePending).toBe(first);

  gate.resolve({ n: 3 });
  await first;

  const afterSettle = scope.controller(stable).resolve();
  expect(afterSettle).toBe(first);

  await scope.close();
});
