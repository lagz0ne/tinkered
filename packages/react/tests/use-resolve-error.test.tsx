import type { Operation, Scope } from "@tinker/core";
import { createScope, operation } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useResolve } from "../src/index.ts";
import { Catch } from "./support/boundary.tsx";
import { deferred } from "./support/deferred.ts";

type Resolver = (...call: Scope.CallArgs<number>) => Promise<number>;
type Ctl = { readonly resolve: Resolver; readonly reset: () => void };
type Snapshot = { readonly status: string; readonly data: unknown; readonly error: unknown };

let captured: unknown;
let last: Snapshot | undefined;

function OpRunner<T>({
  op,
  call,
}: {
  op: Operation.Command<T, number>;
  call: Scope.ProvideInput<number>;
}): React.ReactElement {
  const run = useResolve(op);
  last = { status: run.status, data: run.data, error: run.error };
  if (run.status === "error") captured = run.error;
  return (
    <div>
      <button type="button" onClick={() => run.resolve(call)}>
        go
      </button>
      <button type="button" onClick={() => run.reset()}>
        reset
      </button>
      <p>status:{run.status}</p>
    </div>
  );
}

function Exposer({
  op,
  bind,
}: {
  op: Operation.Command<Promise<number>, number>;
  bind: (ctl: Ctl) => void;
}): React.ReactElement {
  const run = useResolve(op);
  bind({ resolve: run.resolveAsync, reset: run.reset });
  last = { status: run.status, data: run.data, error: run.error };
  return <p>status:{run.status}</p>;
}

test("a failing operation stays in error state and does not throw to an error boundary", async () => {
  captured = undefined;
  const scope = createScope();
  const gate = deferred<number>();
  const failing = operation({
    label: "failing",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => gate.promise.then(() => input),
  });
  const failure = new Error("nope");

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Catch fallback={() => <p>boundary</p>}>
        <OpRunner op={failing} call={{ rawInput: "1" }} />
      </Catch>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("status:idle")).toBeVisible();
  await screen.getByRole("button", { name: "go" }).click();
  await expect.element(screen.getByText("status:pending")).toBeVisible();
  gate.reject(failure);
  await expect.element(screen.getByText("status:error")).toBeVisible();

  expect(captured).toBe(failure);
  await expect.element(screen.getByText("boundary")).not.toBeInTheDocument();

  await scope.close();
});

test("reset from a success clears status, data, and error", async () => {
  last = undefined;
  const scope = createScope();
  const inc = operation({
    label: "inc",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => input + 1,
  });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <OpRunner op={inc} call={{ rawInput: "5" }} />
    </ScopeProvider>,
  );

  await screen.getByRole("button", { name: "go" }).click();
  await expect.element(screen.getByText("status:success")).toBeVisible();
  expect(last).toEqual({ status: "success", data: 6, error: undefined });

  await screen.getByRole("button", { name: "reset" }).click();
  await expect.element(screen.getByText("status:idle")).toBeVisible();
  expect(last).toEqual({ status: "idle", data: undefined, error: undefined });

  await scope.close();
});

test("reset from an error clears status, data, and error", async () => {
  last = undefined;
  const scope = createScope();
  const gate = deferred<number>();
  const failing = operation({
    label: "failing",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => gate.promise.then(() => input),
  });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <OpRunner op={failing} call={{ rawInput: "1" }} />
    </ScopeProvider>,
  );

  await screen.getByRole("button", { name: "go" }).click();
  gate.reject(new Error("nope"));
  await expect.element(screen.getByText("status:error")).toBeVisible();

  await screen.getByRole("button", { name: "reset" }).click();
  await expect.element(screen.getByText("status:idle")).toBeVisible();
  expect(last).toEqual({ status: "idle", data: undefined, error: undefined });

  await scope.close();
});

test("reset during a pending run drops the late result: state stays idle", async () => {
  last = undefined;
  const scope = createScope();
  const gate = deferred<number>();
  const slow = operation({
    label: "slow",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => gate.promise.then(() => input),
  });

  let ctl: Ctl | undefined;
  const ui = (
    <ScopeProvider scope={scope}>
      <Exposer
        op={slow}
        bind={(c) => {
          ctl = c;
        }}
      />
    </ScopeProvider>
  );
  const screen = await render(ui);
  if (!ctl) throw new Error("ctl was not bound");

  const running = ctl.resolve({ rawInput: "7" });
  await expect.element(screen.getByText("status:pending")).toBeVisible();

  ctl.reset();
  await expect.element(screen.getByText("status:idle")).toBeVisible();

  gate.resolve(7);
  await running;
  await screen.rerender(ui);

  expect(last).toEqual({ status: "idle", data: undefined, error: undefined });

  await scope.close();
});
