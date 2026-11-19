import { createScope, data, resource } from "@tinkered/core";
import { Activity, StrictMode, useState } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";

import {
  ScopeProvider,
  SessionProvider,
  isError,
  useData,
  useRelease,
  useResource,
  useScope,
} from "@/index";

import { Catch } from "./support/boundary";

const greeting = data({ label: "greeting", initial: "hi" });

function Greeting(): React.ReactElement {
  const scope = useScope();
  return <p>{scope.controller(greeting).get()}</p>;
}

test("uses the exact app-owned scope and never closes it", async () => {
  const scope = createScope();
  scope.controller(greeting).set("seeded");

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Greeting />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("seeded")).toBeVisible();
  await screen.unmount();

  expect(scope.controller(greeting).get()).toBe("seeded");
  await scope.close();
});

test("create mode closes the owned scope exactly once on unmount", async () => {
  let closes = 0;
  const create = () => {
    const scope = createScope();
    scope.onClose(() => {
      closes += 1;
    });
    return scope;
  };

  const screen = await render(
    <ScopeProvider create={create}>
      <Greeting />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("hi")).toBeVisible();
  await screen.unmount();
  await expect.poll(() => closes).toBe(1);
});

test("under StrictMode, create mode leaks no scope and never exposes a closed one", async () => {
  let creates = 0;
  let closes = 0;
  const create = () => {
    creates += 1;
    const scope = createScope();
    scope.onClose(() => {
      closes += 1;
    });
    return scope;
  };

  const screen = await render(
    <StrictMode>
      <ScopeProvider create={create}>
        <Greeting />
      </ScopeProvider>
    </StrictMode>,
  );

  await expect.element(screen.getByText("hi")).toBeVisible();
  await screen.unmount();
  await expect.poll(() => creates > 0 && creates === closes).toBe(true);
});

test("a new scope on the provider mounts its subtree again", async () => {
  const first = createScope();
  const second = createScope();

  function Switcher(): React.ReactElement {
    const [scope, setScope] = useState(first);
    return (
      <>
        <button type="button" onClick={() => setScope(second)}>
          swap
        </button>
        <ScopeProvider scope={scope}>
          <input aria-label="draft" />
        </ScopeProvider>
      </>
    );
  }

  const screen = await render(<Switcher />);
  await screen.getByRole("textbox", { name: "draft" }).fill("typed");
  await screen.getByRole("button").click();

  await expect.element(screen.getByRole("textbox", { name: "draft" })).toHaveValue("");
  await first.close();
  await second.close();
});

function label(error: unknown): string {
  if (!isError(error, "NoProvider")) throw error;
  return `caught:${error.payload.hook}`;
}

const answer = resource({ label: "answer", factory: () => 42 });

function ReadsData(): React.ReactElement {
  return <p>{useData(greeting)}</p>;
}

function ReadsResource(): React.ReactElement {
  return <p>{useResource(answer)}</p>;
}

function Releases(): React.ReactElement {
  useRelease();
  return <p>release</p>;
}

test.each([
  ["useScope", <Greeting />],
  ["useData", <ReadsData />],
  ["useResource", <ReadsResource />],
  ["useRelease", <Releases />],
  [
    "SessionProvider",
    <SessionProvider>
      <p>session</p>
    </SessionProvider>,
  ],
])("%s used with no provider raises NoProvider", async (_name, view) => {
  const screen = await render(<Catch fallback={(error) => <p>{label(error)}</p>}>{view}</Catch>);

  await expect.element(screen.getByText("caught:useScope")).toBeVisible();
});

test("an Activity hide closes the created scope, and a show renders only with a fresh one", async () => {
  const closed = new Set<unknown>();
  const create = () => {
    const scope = createScope();
    scope.onClose(() => {
      closed.add(scope);
    });
    return scope;
  };
  const stale: unknown[] = [];

  function Probe(): React.ReactElement {
    const scope = useScope();
    if (closed.has(scope)) stale.push(scope);
    return <p>{closed.size === 0 ? "first" : "again"}</p>;
  }

  function Toggle(): React.ReactElement {
    const [shown, setShown] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setShown(!shown)}>
          toggle
        </button>
        <Activity mode={shown ? "visible" : "hidden"}>
          <ScopeProvider create={create}>
            <Probe />
          </ScopeProvider>
        </Activity>
      </>
    );
  }

  const screen = await render(<Toggle />);
  await expect.element(screen.getByText("first")).toBeVisible();
  await screen.getByRole("button", { name: "toggle" }).click();
  await expect.poll(() => closed.size).toBe(1);
  await screen.getByRole("button", { name: "toggle" }).click();

  await expect.element(screen.getByText("again")).toBeVisible();
  expect(stale).toEqual([]);
});
