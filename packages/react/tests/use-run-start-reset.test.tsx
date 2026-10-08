import { createScope, operation } from "@tinker/core";
import { act } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useRun, type Run } from "../src/index";

const resetOnStart = operation({
  label: "resetOnStart",
  input: (raw) => raw as () => void,
  run: (_deps, { input }) => {
    input();
    return Promise.resolve(42);
  },
});

function Runner({ bind }: { bind: (run: Run.Handle<number, () => void>) => void }) {
  const run = useRun(resetOnStart);
  bind(run);
  return <p>status:{run.status}</p>;
}

test("reset during operation startup keeps idle when the old run finishes", async () => {
  const root = createScope();
  let captured: Run.Handle<number, () => void> | undefined;
  try {
    const screen = await render(
      <ScopeProvider scope={root}>
        <Runner
          bind={(run) => {
            captured = run;
          }}
        />
      </ScopeProvider>,
    );
    await expect.element(screen.getByText("status:idle")).toBeVisible();
    if (!captured) throw new Error("runner did not mount");
    const run = captured;
    await act(async () => {
      await expect(run.runAsync({ rawInput: run.reset })).resolves.toBe(42);
    });
    await expect.element(screen.getByText("status:idle")).toBeVisible();
  } finally {
    expect((await root.close({ graceful: true })).status).toBe("success");
  }
});
