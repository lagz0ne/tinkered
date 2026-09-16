import type { Resource } from "@tinker/core";
import { createScope, resource } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, SessionProvider, useResource } from "../src/index.ts";

let builds = 0;
const perSession = resource({
  label: "perSession",
  target: "session",
  factory: () => ({ id: ++builds }),
});
const perScope = resource({
  label: "perScope",
  target: "scope",
  factory: () => ({ id: ++builds }),
});

const grabbed: Record<string, { id: number }> = {};

function Grab({
  handle,
  slot,
}: {
  handle: Resource.Handle<{ id: number }>;
  slot: string;
}): React.ReactElement {
  grabbed[slot] = useResource(handle);
  return <p>ready:{slot}</p>;
}

test("a session-target resource is one instance per SessionProvider; siblings are distinct", async () => {
  const scope = createScope();

  const screen = await render(
    <ScopeProvider scope={scope}>
      <SessionProvider>
        <Grab handle={perSession} slot="a" />
        <Grab handle={perSession} slot="a2" />
      </SessionProvider>
      <SessionProvider>
        <Grab handle={perSession} slot="b" />
      </SessionProvider>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("ready:a2")).toBeVisible();
  await expect.element(screen.getByText("ready:b")).toBeVisible();
  expect(grabbed.a).toBe(grabbed.a2);
  expect(grabbed.a).not.toBe(grabbed.b);

  await scope.close();
});

test("a scope-target resource is the same instance across sibling sessions", async () => {
  const scope = createScope();

  const screen = await render(
    <ScopeProvider scope={scope}>
      <SessionProvider>
        <Grab handle={perScope} slot="c" />
      </SessionProvider>
      <SessionProvider>
        <Grab handle={perScope} slot="d" />
      </SessionProvider>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("ready:c")).toBeVisible();
  await expect.element(screen.getByText("ready:d")).toBeVisible();
  expect(grabbed.c).toBe(grabbed.d);

  await scope.close();
});
