import type { Resource } from "@tinker/core";
import { createScope, resource } from "@tinker/core";
import { Suspense } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useResource } from "../src/index.ts";
import { Catch } from "./support/boundary.tsx";
import { deferred } from "./support/deferred.ts";

type Boxed = { x: number };

function Show({ handle }: { handle: Resource.Handle<Promise<Boxed>> }): React.ReactElement {
  return <p>x:{useResource(handle).x}</p>;
}

function ShowSync({ handle }: { handle: Resource.Handle<Boxed> }): React.ReactElement {
  return <p>x:{useResource(handle).x}</p>;
}

function label(error: unknown): string {
  if (!(error instanceof Error)) throw error;
  return `boom:${error.message}`;
}

test("a rejected async build surfaces to the nearest error boundary", async () => {
  const scope = createScope();
  const gate = deferred<Boxed>();
  const failing = resource({ label: "failing", factory: () => gate.promise });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Catch fallback={(error) => <p>{label(error)}</p>}>
        <Suspense fallback={<p>loading</p>}>
          <Show handle={failing} />
        </Suspense>
      </Catch>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("loading")).toBeVisible();
  gate.reject(new Error("nope"));
  await expect.element(screen.getByText("boom:nope")).toBeVisible();

  await scope.close();
});

test("a throwing sync build surfaces to the nearest error boundary", async () => {
  const scope = createScope();
  const badSync = resource({
    label: "badSync",
    factory: (): Boxed => {
      throw new Error("sync-boom");
    },
  });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Catch fallback={(error) => <p>{label(error)}</p>}>
        <ShowSync handle={badSync} />
      </Catch>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("boom:sync-boom")).toBeVisible();

  await scope.close();
});
