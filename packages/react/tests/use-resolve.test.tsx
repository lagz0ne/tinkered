import type { Operation, Scope } from "@tinker/core";
import { createScope, operation } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useResolve } from "../src/index.ts";
import { deferred } from "./support/deferred.ts";

function Runner<T>({
  op,
  call,
}: {
  op: Operation.Command<T, number>;
  call: Scope.ProvideInput<number>;
}): React.ReactElement {
  const run = useResolve(op);
  return (
    <div>
      <button type="button" onClick={() => void run.resolve(call)}>
        go
      </button>
      <p>status:{run.status}</p>
      <p>data:{run.status === "success" ? String(run.data) : "-"}</p>
    </div>
  );
}

type Resolver = (...call: Scope.CallArgs<number>) => Promise<void>;

function Exposer({
  op,
  bind,
}: {
  op: Operation.Command<Promise<number>, number>;
  bind: (resolve: Resolver) => void;
}): React.ReactElement {
  const run = useResolve(op);
  bind(run.resolve);
  return <p>data:{run.status === "success" ? String(run.data) : run.status}</p>;
}

test("runs an operation imperatively: idle -> pending -> success, with rawInput parsed", async () => {
  const scope = createScope();
  const gate = deferred<void>();
  const doubleAsync = operation({
    label: "doubleAsync",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => gate.promise.then(() => input * 2),
  });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Runner op={doubleAsync} call={{ rawInput: "21" }} />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("status:idle")).toBeVisible();
  await screen.getByRole("button").click();
  await expect.element(screen.getByText("status:pending")).toBeVisible();
  gate.resolve();
  await expect.element(screen.getByText("status:success")).toBeVisible();
  await expect.element(screen.getByText("data:42")).toBeVisible();

  await scope.close();
});

test("a synchronous operation resolves to success with its value", async () => {
  const scope = createScope();
  const inc = operation({
    label: "inc",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => input + 1,
  });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Runner op={inc} call={{ rawInput: "5" }} />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("status:idle")).toBeVisible();
  await screen.getByRole("button").click();
  await expect.element(screen.getByText("data:6")).toBeVisible();

  await scope.close();
});

test("only the latest run publishes: a stale earlier run that settles later is dropped", async () => {
  const scope = createScope();
  const gateA = deferred<void>();
  const gateB = deferred<void>();
  const raced = operation({
    label: "raced",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => (input === 1 ? gateA.promise : gateB.promise).then(() => input),
  });

  let resolve: Resolver | undefined;
  const ui = (
    <ScopeProvider scope={scope}>
      <Exposer
        op={raced}
        bind={(r) => {
          resolve = r;
        }}
      />
    </ScopeProvider>
  );
  const screen = await render(ui);
  if (!resolve) throw new Error("resolve was not bound");

  const runA = resolve({ rawInput: "1" });
  const runB = resolve({ rawInput: "2" });

  gateB.resolve();
  await runB;
  await screen.rerender(ui);
  await expect.element(screen.getByText("data:2")).toBeVisible();

  gateA.resolve();
  await runA;
  await screen.rerender(ui);

  await expect.element(screen.getByText("data:2")).toBeVisible();
  await expect.element(screen.getByText("data:1")).not.toBeInTheDocument();

  await scope.close();
});
