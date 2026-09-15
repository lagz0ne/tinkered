import { Suspense, use } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { deferred } from "./support/deferred.ts";

function Value({ pending }: { pending: Promise<string> }): React.ReactElement {
  return <p>{use(pending)}</p>;
}

test("a Suspense tree resolves when the deferred fixture settles, in a real browser", async () => {
  const gate = deferred<string>();

  const screen = await render(
    <Suspense fallback={<p>loading</p>}>
      <Value pending={gate.promise} />
    </Suspense>,
  );

  await expect.element(screen.getByText("loading")).toBeVisible();
  gate.resolve("ready");
  await expect.element(screen.getByText("ready")).toBeVisible();
});
