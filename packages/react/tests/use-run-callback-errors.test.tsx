import type { Operation } from "@tinker/core";
import { createScope, operation } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import type { Run } from "../src/index";
import { ScopeProvider, useRun } from "../src/index";

const answer = operation({ label: "callback-answer", run: () => 42 });
const operationError = new Error("operation failed");
const failure = operation({
  label: "callback-failure",
  run: (): number => {
    throw operationError;
  },
});
const callbackError = new Error("callback failed");
const throwsOnSuccess = {
  onSuccess: () => {
    throw callbackError;
  },
};

function Runner({
  options,
  bind,
  op = answer,
}: {
  options: Run.Options<number, void>;
  bind?: (run: Run.Handle<number, void>) => void;
  op?: Operation.Handle<number, void>;
}): React.ReactElement {
  const run = useRun(op, options);
  bind?.(run);
  return (
    <button type="button" onClick={() => run.run()}>
      run
    </button>
  );
}

test("runAsync keeps the operation value when onSuccess throws", async () => {
  const root = createScope();
  const receive = (event: ErrorEvent) => {
    if (event.error !== callbackError) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener("error", receive, true);
  let captured: Run.Handle<number, void> | undefined;
  try {
    await render(
      <ScopeProvider scope={root}>
        <Runner
          options={throwsOnSuccess}
          bind={(run) => {
            captured = run;
          }}
        />
      </ScopeProvider>,
    );
    if (captured === undefined) throw callbackError;
    await expect(captured.runAsync()).resolves.toBe(42);
  } finally {
    window.removeEventListener("error", receive, true);
    expect((await root.close({ graceful: true })).status).toBe("success");
  }
});

test("run reports an onSuccess error through the global error event", async () => {
  const root = createScope();
  const errors: unknown[] = [];
  const receive = (event: ErrorEvent) => {
    if (event.error !== callbackError) return;
    errors.push(event.error);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener("error", receive, true);
  try {
    const screen = await render(
      <ScopeProvider scope={root}>
        <Runner options={throwsOnSuccess} />
      </ScopeProvider>,
    );
    await screen.getByRole("button", { name: "run" }).click();
    await expect.poll(() => errors).toEqual([callbackError]);
  } finally {
    window.removeEventListener("error", receive, true);
    expect((await root.close({ graceful: true })).status).toBe("success");
  }
});

test.each([answer, failure])(
  "a callback failure still runs onSettled and keeps the operation outcome: $label",
  async (op) => {
    const root = createScope();
    const settledError = new Error("settled failed");
    const errors: unknown[] = [];
    const receive = (event: ErrorEvent) => {
      if (event.error !== callbackError && event.error !== settledError) return;
      errors.push(event.error);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("error", receive, true);
    let captured: Run.Handle<number, void> | undefined;
    try {
      await render(
        <ScopeProvider scope={root}>
          <Runner
            op={op}
            options={{
              ...throwsOnSuccess,
              onError: throwsOnSuccess.onSuccess,
              onSettled: () => {
                throw settledError;
              },
            }}
            bind={(run) => {
              captured = run;
            }}
          />
        </ScopeProvider>,
      );
      if (captured === undefined) throw callbackError;
      if (op === answer) await expect(captured.runAsync()).resolves.toBe(42);
      else await expect(captured.runAsync()).rejects.toBe(operationError);
      expect(errors).toEqual([callbackError, settledError]);
    } finally {
      window.removeEventListener("error", receive, true);
      expect((await root.close({ graceful: true })).status).toBe("success");
    }
  },
);
