import { createScope, operation, tag, type Operation } from "@tinker/core";
import { StrictMode, useLayoutEffect, useRef } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useRun, type Run } from "../src/index";
import { deferred } from "./support/deferred";

const answer = tag<Promise<string>>({ label: "answer" });

const readAnswer = operation({
  label: "readAnswer",
  depends: { answer },
  run: ({ answer }) => answer,
});

const readOther = operation({
  label: "readOther",
  depends: { answer },
  run: ({ answer }) => answer,
});

type Seen = { run?: Run.Handle<string, void>; calls: string[] };

function View({
  op,
  seen,
}: {
  op: Operation.Handle<Promise<string>, void>;
  seen: Seen;
}): React.ReactElement {
  const run = useRun(op, { onSuccess: (value) => seen.calls.push(value) });
  seen.run = run;
  return <p>value:{run.status === "success" ? run.data : run.status}</p>;
}

test("switching providers clears the previous run state", async () => {
  const first = createScope({ tags: [answer(Promise.resolve("first"))] });
  const second = createScope({ tags: [answer(Promise.resolve("second"))] });
  const seen: Seen = { calls: [] };
  const screen = await render(
    <ScopeProvider scope={first}>
      <View op={readAnswer} seen={seen} />
    </ScopeProvider>,
  );
  if (!seen.run) throw new Error("missing run");
  await seen.run.runAsync();
  await expect.element(screen.getByText("value:first")).toBeVisible();

  await screen.rerender(
    <ScopeProvider scope={second}>
      <View op={readAnswer} seen={seen} />
    </ScopeProvider>,
  );
  await expect.element(screen.getByText("value:idle")).toBeVisible();
  await first.close();
  await second.close();
});

test("switching providers drops late results and callbacks while the caller still gets its value", async () => {
  const gate = deferred<string>();
  const first = createScope({ tags: [answer(gate.promise)] });
  const second = createScope({ tags: [answer(Promise.resolve("second"))] });
  const before: Seen = { calls: [] };
  const after: Seen = { calls: [] };
  const screen = await render(
    <ScopeProvider scope={first}>
      <View op={readAnswer} seen={before} />
    </ScopeProvider>,
  );
  if (!before.run) throw new Error("missing run");
  const running = before.run.runAsync();
  await screen.rerender(
    <ScopeProvider scope={second}>
      <View op={readAnswer} seen={after} />
    </ScopeProvider>,
  );
  gate.resolve("first");
  expect(await running).toBe("first");
  await expect.element(screen.getByText("value:idle")).toBeVisible();
  expect(after.calls).toEqual([]);
  expect(before.calls).toEqual([]);
  await first.close();
  await second.close();
});

test("switching operations drops late results and callbacks from the old operation", async () => {
  const gate = deferred<string>();
  const scope = createScope({ tags: [answer(gate.promise)] });
  const seen: Seen = { calls: [] };
  const screen = await render(
    <ScopeProvider scope={scope}>
      <View op={readAnswer} seen={seen} />
    </ScopeProvider>,
  );
  if (!seen.run) throw new Error("missing run");
  const running = seen.run.runAsync();
  await screen.rerender(
    <ScopeProvider scope={scope}>
      <View op={readOther} seen={seen} />
    </ScopeProvider>,
  );
  gate.resolve("old");
  await running;
  await expect.element(screen.getByText("value:idle")).toBeVisible();
  expect(seen.calls).toEqual([]);
  await scope.close();
});

test("a parent render keeps the run handle when no run changed", async () => {
  const scope = createScope({ tags: [answer(Promise.resolve("answer"))] });
  const seen: Seen = { calls: [] };
  const screen = await render(
    <ScopeProvider scope={scope}>
      <View op={readAnswer} seen={seen} />
    </ScopeProvider>,
  );
  const first = seen.run;
  await screen.rerender(
    <ScopeProvider scope={scope}>
      <View op={readAnswer} seen={seen} />
    </ScopeProvider>,
  );
  expect(seen.run).toBe(first);
  expect((await scope.close({ graceful: true })).status).toBe("success");
});

const replayed = operation({ label: "replayed-run", run: () => "done" });

function Replay(): React.ReactElement {
  const run = useRun(replayed);
  const started = useRef(false);
  useLayoutEffect(() => {
    if (!started.current) {
      started.current = true;
      run.run();
    }
  }, [run]);
  return <p>replay:{run.status}</p>;
}

test("StrictMode clears the run from its discarded effect mount", async () => {
  const scope = createScope();
  try {
    const screen = await render(
      <StrictMode>
        <ScopeProvider scope={scope}>
          <Replay />
        </ScopeProvider>
      </StrictMode>,
    );
    await expect.element(screen.getByText("replay:idle")).toBeVisible();
  } finally {
    expect((await scope.close({ graceful: true })).status).toBe("success");
  }
});

test("a cancelled run rejects with the caller's exact reason", async () => {
  const scope = createScope();
  const seen: Seen = { calls: [] };
  const stop = new AbortController();
  const reason = new Error("caller stopped");
  stop.abort(reason);
  try {
    await render(
      <ScopeProvider scope={scope}>
        <View op={readAnswer} seen={seen} />
      </ScopeProvider>,
    );
    if (!seen.run) throw new Error("missing run");
    await expect(seen.run.runAsync({ signal: stop.signal })).rejects.toBe(reason);
  } finally {
    expect((await scope.close({ graceful: true })).status).toBe("success");
  }
});
