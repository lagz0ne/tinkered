import type { Scope } from "@tinker/core";
import { createScope, data, resource } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import {
  ScopeProvider,
  SessionProvider,
  useController,
  useData,
  useResource,
} from "../src/index.ts";

const cell = data({ label: "cell", initial: "root" });

let end: string | undefined;
const conn = resource({
  label: "conn",
  target: "session",
  factory: (_deps, { defer }) => {
    defer((settled) => {
      end = settled.status;
    });
    return { ok: true };
  },
});

function UseConn(): React.ReactElement {
  const built = useResource(conn);
  return <p>ok:{String(built.ok)}</p>;
}

function AboveReader(): React.ReactElement {
  return <p>above:{useData(cell)}</p>;
}

function UnderReader(): React.ReactElement {
  return <p>under:{useData(cell)}</p>;
}

function UnderWriter(): React.ReactElement {
  const control = useController(cell);
  return (
    <button type="button" onClick={() => control.set("session")}>
      write
    </button>
  );
}

test("unmounting the provider force-closes the session: a session resource's defer rolls back", async () => {
  end = undefined;
  const scope = createScope();

  const screen = await render(
    <ScopeProvider scope={scope}>
      <SessionProvider>
        <UseConn />
      </SessionProvider>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("ok:true")).toBeVisible();
  await screen.unmount();
  await expect.poll(() => end).toBe("cancelled");

  await scope.close();
});

test("a data write under the session is shadowed and does not reach the parent scope", async () => {
  const scope = createScope();

  const screen = await render(
    <ScopeProvider scope={scope}>
      <AboveReader />
      <SessionProvider>
        <UnderWriter />
        <UnderReader />
      </SessionProvider>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("above:root")).toBeVisible();
  await expect.element(screen.getByText("under:root")).toBeVisible();

  await screen.getByRole("button").click();

  await expect.element(screen.getByText("under:session")).toBeVisible();
  await expect.element(screen.getByText("above:root")).toBeVisible();

  await scope.close();
});

const uiFor = (scope: Scope.Handle): React.ReactElement => (
  <ScopeProvider scope={scope}>
    <SessionProvider>
      <UseConn />
    </SessionProvider>
  </ScopeProvider>
);

test("switching the parent scope never exposes the old session, even if the old parent is closed", async () => {
  end = undefined;
  const scopeA = createScope();
  const scopeB = createScope();

  const screen = await render(uiFor(scopeA));
  await expect.element(screen.getByText("ok:true")).toBeVisible();

  await scopeA.close();
  await screen.rerender(uiFor(scopeB));

  await expect.element(screen.getByText("ok:true")).toBeVisible();

  await scopeB.close();
});
