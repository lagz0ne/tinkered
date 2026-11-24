import { createScope, data } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { useLayoutEffect } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { ScopeProvider, useData } from "@/index";

/** A plain cell, not a keyed one: a keyed cell's read gives a new array at close with no write,
 * so React renders the reader again, and that render raises `Disposed` (ADR 0144 d3). */
const count = data({ label: "closed.count", initial: 1 });

function Count(): React.ReactElement {
  return <p>{`count:${useData(count)}`}</p>;
}

function Doubled(): React.ReactElement {
  return <p>{`doubled:${useData(count, (n) => n * 2)}`}</p>;
}

test("a scope that closes before useData subscribes reports no error", async () => {
  const scope = createScope();
  const errors: unknown[] = [];
  const receive = (event: ErrorEvent): void => {
    errors.push(event.error);
    event.preventDefault();
  };
  let closing: Promise<Scope.Result> | undefined;
  function Closer(): null {
    useLayoutEffect(() => {
      closing = scope.close({ graceful: true });
    }, []);
    return null;
  }

  window.addEventListener("error", receive, true);
  try {
    const screen = await render(
      <ScopeProvider scope={scope}>
        <Count />
        <Doubled />
        <Closer />
      </ScopeProvider>,
    );
    await expect.element(screen.getByText("count:1")).toBeVisible();
    await expect.element(screen.getByText("doubled:2")).toBeVisible();
  } finally {
    window.removeEventListener("error", receive, true);
  }

  expect(errors).toEqual([]);
  expect((await closing)?.status).toBe("success");
});
