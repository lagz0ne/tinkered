import { createScope, data } from "@tinker/core";
import { useState } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useData } from "../src/index.ts";

const box = data({ label: "box", initial: { a: 1, b: 1 } });

function SliceA({ onRender }: { onRender: () => void }): React.ReactElement {
  const a = useData(box, (v) => v.a);
  onRender();
  return <p>a:{a}</p>;
}

function SliceB(): React.ReactElement {
  return <p>b:{useData(box, (v) => v.b)}</p>;
}

const pickA = (v: { a: number; b: number }): { a: number } => ({ a: v.a });

function SliceStable({ onSeen }: { onSeen: (slice: object) => void }): React.ReactElement {
  const slice = useData(box, pickA);
  onSeen(slice);
  return <p>sa:{slice.a}</p>;
}

function SliceObj({ onRender }: { onRender: () => void }): React.ReactElement {
  const slice = useData(
    box,
    (v) => ({ a: v.a }),
    (x, y) => x.a === y.a,
  );
  onRender();
  return <p>obj-a:{slice.a}</p>;
}

test("re-renders only when the selected slice changes", async () => {
  const scope = createScope();
  let renders = 0;

  const screen = await render(
    <ScopeProvider scope={scope}>
      <SliceA
        onRender={() => {
          renders += 1;
        }}
      />
      <SliceB />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("a:1")).toBeVisible();
  await expect.element(screen.getByText("b:1")).toBeVisible();
  const afterMount = renders;

  scope.getController(box).update((v) => ({ ...v, b: 2 }));
  await expect.element(screen.getByText("b:2")).toBeVisible();
  expect(renders).toBe(afterMount);

  scope.getController(box).update((v) => ({ ...v, a: 2 }));
  await expect.element(screen.getByText("a:2")).toBeVisible();
  expect(renders).toBeGreaterThan(afterMount);

  await scope.close();
});

test("a stable object selector without isEqual keeps its result identity across a parent re-render", async () => {
  const scope = createScope();
  const seen: object[] = [];

  function Parent(): React.ReactElement {
    const [n, setN] = useState(0);
    return (
      <button type="button" onClick={() => setN((x) => x + 1)}>
        bump {n}
        <SliceStable onSeen={(slice) => seen.push(slice)} />
      </button>
    );
  }

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Parent />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("sa:1")).toBeVisible();
  await screen.getByRole("button").click();
  await expect.element(screen.getByText("bump 1")).toBeVisible();

  expect(seen.length).toBeGreaterThan(1);
  expect(seen[seen.length - 1]).toBe(seen[0]);

  await scope.close();
});

test("a new inline selector after a parent re-render shows its output and still follows the cell", async () => {
  const scope = createScope();

  function Swapper({ pick }: { pick: "a" | "b" }): React.ReactElement {
    const value = useData(box, (v) => (pick === "a" ? v.a : v.b));
    return <p>picked:{value}</p>;
  }

  function Parent(): React.ReactElement {
    const [pick, setPick] = useState<"a" | "b">("a");
    return (
      <button type="button" onClick={() => setPick("b")}>
        pick:{pick}
        <Swapper pick={pick} />
      </button>
    );
  }

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Parent />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("picked:1")).toBeVisible();
  scope.getController(box).update((v) => ({ ...v, b: 9 }));
  await expect.element(screen.getByText("picked:1")).toBeVisible();

  await screen.getByRole("button").click();
  await expect.element(screen.getByText("pick:b")).toBeVisible();
  await expect.element(screen.getByText("picked:9")).toBeVisible();

  scope.getController(box).update((v) => ({ ...v, b: 10 }));
  await expect.element(screen.getByText("picked:10")).toBeVisible();

  await scope.close();
});

test("a custom isEqual suppresses re-render for a new slice it treats as equal", async () => {
  const scope = createScope();
  let renders = 0;

  const screen = await render(
    <ScopeProvider scope={scope}>
      <SliceObj
        onRender={() => {
          renders += 1;
        }}
      />
      <SliceB />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("obj-a:1")).toBeVisible();
  const afterMount = renders;

  scope.getController(box).update((v) => ({ ...v, b: 3 }));
  await expect.element(screen.getByText("b:3")).toBeVisible();
  expect(renders).toBe(afterMount);

  await scope.close();
});
