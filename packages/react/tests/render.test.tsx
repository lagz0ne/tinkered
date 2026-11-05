import { capsule, createScope, data, isError, operation, resource } from "@tinker/core";
import { preset } from "@tinker/core/testing";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { Render, ScopeProvider, SessionProvider, useData, useRun } from "@/index";

import { Catch } from "./support/boundary";
import { deferred } from "./support/deferred";

const draft = data({ label: "talk.draft", initial: "" });

const type = operation({
  label: "talk.type",
  input: (raw: unknown) => String(raw),
  depends: { draft: draft.controller },
  run: ({ draft }, { input }) => draft.set(input),
});

let builds = 0;

/** A renderable resource: it builds a component bound to the capsule's own, unexported cell. */
const panel = resource({
  label: "talk.panel",
  depends: { draft: draft.controller },
  factory: () => {
    builds += 1;
    return function Panel(props: { title: string; children?: ReactNode }): ReactNode {
      const text = useData(draft);
      const typing = useRun(type);
      return (
        <section>
          <h2>{props.title}</h2>
          <input
            aria-label="draft"
            value={text}
            onChange={(e) => typing.run({ rawInput: e.currentTarget.value })}
          />
          <p>draft:{text}</p>
          {props.children}
        </section>
      );
    };
  },
});

const talk = capsule({ label: "talk", exports: { panel } });

test("Render builds the resource's component and hands it the other props", async () => {
  const scope = createScope({ capsules: [talk] });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Render of={talk.panel} title="Talk">
        <p>child</p>
      </Render>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("Talk")).toBeVisible();
  await expect.element(screen.getByText("child")).toBeVisible();

  await scope.close();
});

test("the built component keeps its identity across renders, so its DOM is not remounted", async () => {
  const scope = createScope({ capsules: [talk] });
  builds = 0;
  const screen = await render(
    <ScopeProvider scope={scope}>
      <Render of={talk.panel} title="Talk" />
    </ScopeProvider>,
  );
  const input = screen.getByLabelText("draft").element();

  await screen.getByLabelText("draft").fill("hi");
  await screen.rerender(
    <ScopeProvider scope={scope}>
      <Render of={talk.panel} title="Talk 2" />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("Talk 2")).toBeVisible();
  await expect.element(screen.getByText("draft:hi")).toBeVisible();
  expect(screen.getByLabelText("draft").element()).toBe(input);
  expect(builds).toBe(1);

  await scope.close();
});

test("an async build suspends, then renders the component", async () => {
  const gate = deferred<(props: { name: string }) => ReactNode>();
  const lazy = resource({ label: "lazy.view", factory: () => gate.promise });
  const scope = createScope();
  const screen = await render(
    <ScopeProvider scope={scope}>
      <Suspense fallback={<p>loading</p>}>
        <Render of={lazy} name="ada" />
      </Suspense>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("loading")).toBeVisible();
  gate.resolve((props) => <p>hello {props.name}</p>);

  await expect.element(screen.getByText("hello ada")).toBeVisible();

  await scope.close();
});

test("a renderable resource whose capsule is not installed raises CapsuleMissing", async () => {
  const scope = createScope();

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Catch fallback={(error) => <p>missing:{String(isError(error, "CapsuleMissing"))}</p>}>
        <Render of={talk.panel} title="Talk" />
      </Catch>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("missing:true")).toBeVisible();

  await scope.close();
});

test("a preset replaces the whole component a renderable resource builds", async () => {
  const fake = (props: { title: string }): ReactNode => <p>fake {props.title}</p>;
  const scope = createScope({ capsules: [talk], presets: [preset(talk.panel, () => fake)] });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Render of={talk.panel} title="Talk" />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("fake Talk")).toBeVisible();

  await scope.close();
});

test("a session resource builds one component per SessionProvider", async () => {
  let sessionBuilds = 0;
  const badge = resource({
    label: "badge",
    target: "session",
    factory: () => {
      sessionBuilds += 1;
      const n = sessionBuilds;
      return (props: { who: string }): ReactNode => (
        <p>
          {props.who}:{n}
        </p>
      );
    },
  });
  const scope = createScope();

  const screen = await render(
    <ScopeProvider scope={scope}>
      <SessionProvider>
        <Render of={badge} who="a" />
      </SessionProvider>
      <SessionProvider>
        <Render of={badge} who="b" />
      </SessionProvider>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("a:1")).toBeVisible();
  await expect.element(screen.getByText("b:2")).toBeVisible();

  await scope.close();
});

test("Render types the built component's props and refuses a resource that builds none", () => {
  const plain = resource({ label: "plain", factory: () => (): ReactNode => null });
  const number = resource({ label: "number", factory: () => 42 });

  const typed = [
    <Render key="ok" of={talk.panel} title="Talk" />,
    // @ts-expect-error a required prop of the built component is missing
    <Render key="missing" of={talk.panel} />,
    // @ts-expect-error a prop has the wrong type
    <Render key="wrong" of={talk.panel} title={1} />,
    // @ts-expect-error a component with no props takes no extra prop
    <Render key="extra" of={plain} foo={1} />,
    // @ts-expect-error the resource builds a number, not a component
    <Render key="none" of={number} />,
  ];

  expect(typed).toHaveLength(5);
});
