import { capsule, createScope, data, operation } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { ScopeProvider, useData } from "@/index";

const point = data<string | null>({ label: "talk.point", initial: "a" });

const clearPoint = operation({
  label: "talk.clearPoint",
  depends: { point: point.controller },
  run: ({ point }) => point.set(null),
});

const talk = capsule({ label: "talk", exports: { point, clearPoint } });

test("useData reads a capsule's cell export and re-renders when the owner's op writes", async () => {
  const scope = createScope({ capsules: [talk] });

  function Point(): React.ReactElement {
    return <p>point:{useData(talk.point) ?? "none"}</p>;
  }

  function Bare(): React.ReactElement {
    // @ts-expect-error a capsule's cell export has no writable pair: the value comes back bare
    const bare: unknown = useData(talk.point, { writable: true });
    return <p>bare:{Array.isArray(bare) ? "pair" : String(bare)}</p>;
  }

  function Upper(): React.ReactElement {
    return <p>upper:{useData(talk.point, (v) => v?.toUpperCase() ?? "NONE")}</p>;
  }

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Point />
      <Upper />
      <Bare />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("point:a")).toBeVisible();
  await expect.element(screen.getByText("upper:A")).toBeVisible();
  await expect.element(screen.getByText("bare:a")).toBeVisible();
  await scope.run(talk.clearPoint);
  await expect.element(screen.getByText("point:none")).toBeVisible();
  await expect.element(screen.getByText("upper:NONE")).toBeVisible();

  await scope.close();
});

test("useData on a capsule's cell export has no writable pair", () => {
  // @ts-expect-error a capsule's cell export is read-only
  const read = () => useData(talk.point, { writable: true });

  expect(read).toBeTypeOf("function");
});
