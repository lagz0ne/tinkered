import type { Resource } from "@tinker/core";
import { createScope, isError, resource, tag } from "@tinker/core";
import { Suspense } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useResource } from "../src/index.ts";
import { Catch } from "./support/boundary.tsx";
import { deferred } from "./support/deferred.ts";

type Boxed = { x: number };

const region = tag<string>({ label: "region" });
const needsRegion = resource({
  label: "needsRegion",
  depends: { region: region.required },
  factory: ({ region }) => region,
});

function Show({ handle }: { handle: Resource.Handle<Promise<Boxed>> }): React.ReactElement {
  return <p>x:{useResource(handle).x}</p>;
}

function ShowRegion(): React.ReactElement {
  return <p>r:{useResource(needsRegion)}</p>;
}

let captured: unknown;
function capture(error: unknown): React.ReactElement {
  captured = error;
  return <p>caught</p>;
}

test("a rejected async build delivers the exact failure to the nearest error boundary", async () => {
  const scope = createScope();
  captured = undefined;
  const gate = deferred<Boxed>();
  const failing = resource({ label: "failing", factory: () => gate.promise });
  const failure = new Error("nope");

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Catch fallback={capture}>
        <Suspense fallback={<p>loading</p>}>
          <Show handle={failing} />
        </Suspense>
      </Catch>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("loading")).toBeVisible();
  gate.reject(failure);
  await expect.element(screen.getByText("caught")).toBeVisible();
  expect(captured).toBe(failure);

  await scope.close();
});

test("a rejected build is not rebuilt on the Suspense retry: original error shows, one build", async () => {
  const scope = createScope();
  captured = undefined;
  let builds = 0;
  const gate = deferred<Boxed>();
  const flaky = resource({
    label: "flaky",
    factory: () => {
      builds += 1;
      return builds === 1 ? gate.promise : deferred<Boxed>().promise;
    },
  });
  const failure = new Error("first-fail");

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Catch fallback={capture}>
        <Suspense fallback={<p>loading</p>}>
          <Show handle={flaky} />
        </Suspense>
      </Catch>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("loading")).toBeVisible();
  gate.reject(failure);
  await expect.element(screen.getByText("caught")).toBeVisible();
  expect(captured).toBe(failure);
  expect(builds).toBe(1);

  await scope.close();
});

test("a core registry failure from a build surfaces and narrows via core isError", async () => {
  const scope = createScope();
  captured = undefined;

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Catch fallback={capture}>
        <ShowRegion />
      </Catch>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("caught")).toBeVisible();
  if (!isError(captured, "MissingTag")) throw captured;
  expect(captured.payload.label).toBe("region");

  await scope.close();
});
