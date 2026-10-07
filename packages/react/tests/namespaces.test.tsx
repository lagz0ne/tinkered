import type { Data, Namespace, Resource } from "@tinker/core";
import { createScope, data, namespace, resource, tag } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, SessionProvider, useRelease, useResource } from "../src/index";

const projectName = tag({ label: "project-name", default: "plain" });
const ocean = namespace({ tags: projectName("ocean") });
const forest = namespace({ tags: projectName("forest") });
const draft = data({ label: "project-draft", initial: "empty" });

function Query({
  handle,
  ns,
}: {
  handle: Resource.Handle<object>;
  ns?: Namespace;
}): React.ReactElement {
  const query = useResource(handle, { suspense: false, ns });
  return (
    <div>
      <p>query:{JSON.stringify(query.data)}</p>
      <button type="button" onClick={query.refetch}>
        refetch
      </button>
    </div>
  );
}

function Reset({
  node,
  ns,
}: {
  node: Data.Cell<string> | Resource.Handle<object>;
  ns?: Namespace;
}): React.ReactElement {
  const reset = useRelease(ns);
  return (
    <button type="button" onClick={() => reset(node)}>
      reset
    </button>
  );
}

function Read({
  handle,
  ns,
}: {
  handle: Resource.Handle<object>;
  ns: Namespace;
}): React.ReactElement {
  const value = useResource(handle, { ns });
  return <p>read:{JSON.stringify(value)}</p>;
}

test("a session refetch keeps sibling and default namespace resources", async () => {
  const project = resource({ label: "project", target: "namespace", factory: () => ({}) });
  const scope = createScope();
  const before = scope.resolve(project, { ns: ocean });
  const sibling = scope.resolve(project, { ns: forest });
  const plain = scope.resolve(project);
  const screen = await render(
    <ScopeProvider scope={scope}>
      <SessionProvider options={{ ns: ocean }}>
        <Query handle={project} />
      </SessionProvider>
    </ScopeProvider>,
  );

  await screen.getByRole("button", { name: "refetch" }).click();
  expect(scope.resolve(project, { ns: ocean })).not.toBe(before);
  expect(scope.resolve(project, { ns: forest })).toBe(sibling);
  expect(scope.resolve(project)).toBe(plain);
  await scope.close();
});

test("an explicit field reset keeps sibling and default values at the same owner", async () => {
  const scope = createScope();
  scope.controller(draft).set("default draft");
  scope.controller(draft, { ns: ocean }).set("ocean draft");
  scope.controller(draft, { ns: forest }).set("forest draft");
  const screen = await render(
    <ScopeProvider scope={scope}>
      <Reset node={draft} ns={ocean} />
    </ScopeProvider>,
  );

  await screen.getByRole("button", { name: "reset" }).click();
  expect(scope.resolve(draft, { ns: ocean })).toBe("default draft");
  expect(scope.resolve(draft, { ns: forest })).toBe("forest draft");
  expect(scope.resolve(draft)).toBe("default draft");
  await scope.close();
});

test("explicit resource reads and refetch follow the current key on an app-owned scope", async () => {
  const project = resource({
    label: "named-project",
    target: "namespace",
    depends: { projectName },
    factory: ({ projectName }) => ({ name: projectName }),
  });
  const scope = createScope({ ns: forest });
  const first = scope.resolve(project, { ns: ocean });
  const second = scope.resolve(project);
  const screen = await render(
    <ScopeProvider scope={scope}>
      <Query handle={project} ns={ocean} />
      <Read handle={project} ns={ocean} />
    </ScopeProvider>,
  );
  await expect.element(screen.getByText('query:{"name":"ocean"}')).toBeVisible();
  await expect.element(screen.getByText('read:{"name":"ocean"}')).toBeVisible();
  await screen.rerender(
    <ScopeProvider scope={scope}>
      <Query handle={project} ns={forest} />
      <Read handle={project} ns={ocean} />
    </ScopeProvider>,
  );
  await expect.element(screen.getByText('query:{"name":"forest"}')).toBeVisible();
  await screen.getByRole("button", { name: "refetch" }).click();
  expect(scope.resolve(project)).not.toBe(second);
  expect(scope.resolve(project, { ns: ocean })).toBe(first);
  await scope.close();
});

test("a nested session inherits its parent's reset key", async () => {
  const project = resource({ label: "nested-project", target: "namespace", factory: () => ({}) });
  const scope = createScope();
  const first = scope.resolve(project, { ns: ocean });
  const second = scope.resolve(project, { ns: forest });
  const screen = await render(
    <ScopeProvider scope={scope}>
      <SessionProvider options={{ ns: ocean }}>
        <SessionProvider>
          <Query handle={project} />
        </SessionProvider>
      </SessionProvider>
    </ScopeProvider>,
  );
  await screen.getByRole("button", { name: "refetch" }).click();
  expect(scope.resolve(project, { ns: ocean })).not.toBe(first);
  expect(scope.resolve(project, { ns: forest })).toBe(second);
  await scope.close();
});

test("an inner session's explicit key replaces its parent's reset key", async () => {
  const project = resource({ label: "inner-project", target: "namespace", factory: () => ({}) });
  const scope = createScope();
  const first = scope.resolve(project, { ns: ocean });
  const second = scope.resolve(project, { ns: forest });
  const screen = await render(
    <ScopeProvider scope={scope}>
      <SessionProvider options={{ ns: ocean }}>
        <SessionProvider options={{ ns: forest }}>
          <Query handle={project} />
        </SessionProvider>
      </SessionProvider>
    </ScopeProvider>,
  );
  await screen.getByRole("button", { name: "refetch" }).click();
  expect(scope.resolve(project, { ns: forest })).not.toBe(second);
  expect(scope.resolve(project, { ns: ocean })).toBe(first);
  await scope.close();
});

test("an explicit reset key overrides the React session's key", async () => {
  const project = resource({ label: "reset-project", target: "namespace", factory: () => ({}) });
  const scope = createScope();
  const first = scope.resolve(project, { ns: ocean });
  const second = scope.resolve(project, { ns: forest });
  const screen = await render(
    <ScopeProvider scope={scope}>
      <SessionProvider options={{ ns: ocean }}>
        <Reset node={project} ns={forest} />
      </SessionProvider>
    </ScopeProvider>,
  );
  await screen.getByRole("button", { name: "reset" }).click();
  expect(scope.resolve(project, { ns: forest })).not.toBe(second);
  expect(scope.resolve(project, { ns: ocean })).toBe(first);
  await scope.close();
});

test("changing session options without remounting keeps the live reset key", async () => {
  const project = resource({ label: "kept-project", target: "namespace", factory: () => ({}) });
  const scope = createScope();
  const first = scope.resolve(project, { ns: ocean });
  const second = scope.resolve(project, { ns: forest });
  const screen = await render(
    <ScopeProvider scope={scope}>
      <SessionProvider options={{ ns: ocean }}>
        <Query handle={project} />
      </SessionProvider>
    </ScopeProvider>,
  );
  await screen.rerender(
    <ScopeProvider scope={scope}>
      <SessionProvider options={{ ns: forest }}>
        <Query handle={project} />
      </SessionProvider>
    </ScopeProvider>,
  );
  await screen.getByRole("button", { name: "refetch" }).click();
  expect(scope.resolve(project, { ns: ocean })).not.toBe(first);
  expect(scope.resolve(project, { ns: forest })).toBe(second);
  await scope.close();
});

test("a chain refetch clears its head and reuses its fallback", async () => {
  let builds = 0;
  const project = resource({
    label: "chain-project",
    target: "namespace",
    factory: () => ({ build: ++builds }),
  });
  const scope = createScope();
  scope.resolve(project, { ns: ocean });
  const fallback = scope.resolve(project, { ns: forest });
  const screen = await render(
    <ScopeProvider scope={scope}>
      <SessionProvider options={{ ns: [ocean, forest] }}>
        <Query handle={project} />
      </SessionProvider>
    </ScopeProvider>,
  );
  await expect.element(screen.getByText('query:{"build":1}')).toBeVisible();
  await screen.getByRole("button", { name: "refetch" }).click();
  await expect.element(screen.getByText('query:{"build":2}')).toBeVisible();
  expect(scope.resolve(project, { ns: forest })).toBe(fallback);
  await scope.close();
});

test("a named session can still refetch a shared scope resource", async () => {
  const shared = resource({ label: "shared-project", target: "scope", factory: () => ({}) });
  const scope = createScope();
  const first = scope.resolve(shared);
  const screen = await render(
    <ScopeProvider scope={scope}>
      <SessionProvider options={{ ns: ocean }}>
        <Query handle={shared} />
      </SessionProvider>
    </ScopeProvider>,
  );
  await screen.getByRole("button", { name: "refetch" }).click();
  expect(scope.resolve(shared)).not.toBe(first);
  await scope.close();
});

test.each(["borrowed", "owned"])(
  "an independent %s scope clears an outer session's reset key",
  async (mode) => {
    const outer = createScope();
    const inner = createScope();
    inner.controller(draft).set("changed");
    const children = <Reset node={draft} />;
    const screen = await render(
      <ScopeProvider scope={outer}>
        <SessionProvider options={{ ns: ocean }}>
          {mode === "borrowed" ? (
            <ScopeProvider scope={inner}>{children}</ScopeProvider>
          ) : (
            <ScopeProvider create={() => inner}>{children}</ScopeProvider>
          )}
        </SessionProvider>
      </ScopeProvider>,
    );
    await screen.getByRole("button", { name: "reset" }).click();
    expect(inner.resolve(draft)).toBe("empty");
    await screen.unmount();
    await outer.close();
    await inner.close();
  },
);
