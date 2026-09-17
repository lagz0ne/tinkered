import { createScope } from "@tinker/core";
import { Suspense, use } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { deferred, pendingResource } from "./support/deferred.ts";

function Value({ pending }: { pending: Promise<string> }): React.ReactElement {
  return <p>{use(pending)}</p>;
}

test("a Suspense tree resolves when a core resource built on the deferred fixture settles, in a real browser", async () => {
  const gate = deferred<string>();
  const scope = createScope();
  const pending = scope.controller(pendingResource(gate)).resolve();

  const screen = await render(
    <Suspense fallback={<p>loading</p>}>
      <Value pending={pending} />
    </Suspense>,
  );

  await expect.element(screen.getByText("loading")).toBeVisible();
  gate.resolve("ready");
  await expect.element(screen.getByText("ready")).toBeVisible();

  await scope.close();
});
