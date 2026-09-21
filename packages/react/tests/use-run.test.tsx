import type { Operation, Scope } from "@tinker/core";
import { createScope, operation } from "@tinker/core";
import { useState } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, useRun } from "../src/index.ts";
import { deferred } from "./support/deferred.ts";

function Runner<T>({
  op,
  call,
}: {
  op: Operation.Handle<T, number>;
  call: Scope.ProvideInput<number>;
}): React.ReactElement {
  const run = useRun(op);
  return (
    <div>
      <button type="button" onClick={() => run.run(call)}>
        go
      </button>
      <p>status:{run.status}</p>
      <p>data:{run.status === "success" ? String(run.data) : "-"}</p>
    </div>
  );
}

type Resolver = (...call: Scope.CallArgs<number>) => Promise<number>;

function Exposer({
  op,
  bind,
}: {
  op: Operation.Handle<Promise<number>, number>;
  bind: (runAsync: Resolver) => void;
}): React.ReactElement {
  const run = useRun(op);
  bind(run.runAsync);
  return <p>data:{run.status === "success" ? String(run.data) : run.status}</p>;
}

test("switching the operation runs the new one, not the stale one", async () => {
  const scope = createScope();
  const plusOne = operation({
    label: "plusOne",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => Promise.resolve(input + 1),
  });
  const timesTen = operation({
    label: "timesTen",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => Promise.resolve(input * 10),
  });

  function Switcher(): React.ReactElement {
    const [op, setOp] = useState(plusOne);
    const run = useRun(op);
    return (
      <div>
        <button type="button" onClick={() => setOp(timesTen as never)}>
          switch
        </button>
        <button type="button" onClick={() => run.run({ rawInput: "5" })}>
          go
        </button>
        <p>opdata:{run.status === "success" ? String(run.data) : run.status}</p>
      </div>
    );
  }

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Switcher />
    </ScopeProvider>,
  );

  await screen.getByRole("button", { name: "switch" }).click();
  await screen.getByRole("button", { name: "go" }).click();
  await expect.element(screen.getByText("opdata:50")).toBeVisible();

  await scope.close();
});

test("switching the operation rebinds runAsync to the new one", async () => {
  const scope = createScope();
  const plusOne = operation({
    label: "plusOneAsync",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => Promise.resolve(input + 1),
  });
  const timesTen = operation({
    label: "timesTenAsync",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => Promise.resolve(input * 10),
  });

  let runAsync: Resolver | undefined;
  function Switcher(): React.ReactElement {
    const [op, setOp] = useState(plusOne);
    const run = useRun(op);
    runAsync = run.runAsync;
    return (
      <button type="button" onClick={() => setOp(timesTen as never)}>
        switch
      </button>
    );
  }

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Switcher />
    </ScopeProvider>,
  );
  if (!runAsync) throw new Error("runAsync was not bound");

  await screen.getByRole("button", { name: "switch" }).click();
  await expect(runAsync({ rawInput: "5" })).resolves.toBe(50);

  await scope.close();
});

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

test("a synchronous operation runs to success with its value", async () => {
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

  let runAsync: Resolver | undefined;
  const ui = (
    <ScopeProvider scope={scope}>
      <Exposer
        op={raced}
        bind={(r) => {
          runAsync = r;
        }}
      />
    </ScopeProvider>
  );
  const screen = await render(ui);
  if (!runAsync) throw new Error("runAsync was not bound");

  const runA = runAsync({ rawInput: "1" });
  const runB = runAsync({ rawInput: "2" });

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

test("runAsync returns the value and rejects with the failure while state tracks both", async () => {
  const scope = createScope();
  const failure = new Error("nope");
  const pick = operation({
    label: "pick",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => (input > 0 ? Promise.resolve(input) : Promise.reject(failure)),
  });

  let runAsync: Resolver | undefined;
  const ui = (
    <ScopeProvider scope={scope}>
      <Exposer
        op={pick}
        bind={(r) => {
          runAsync = r;
        }}
      />
    </ScopeProvider>
  );
  const screen = await render(ui);
  if (!runAsync) throw new Error("runAsync was not bound");

  await expect(runAsync({ rawInput: "3" })).resolves.toBe(3);
  await screen.rerender(ui);
  await expect.element(screen.getByText("data:3")).toBeVisible();

  await expect(runAsync({ rawInput: "0" })).rejects.toBe(failure);
  await screen.rerender(ui);
  await expect.element(screen.getByText("data:error")).toBeVisible();

  await scope.close();
});

function Flags({
  op,
  call,
  events,
}: {
  op: Operation.Handle<Promise<number>, number>;
  call: Scope.ProvideInput<number>;
  events: string[];
}): React.ReactElement {
  const run = useRun(op, {
    onSuccess: (data, variables) =>
      void events.push(`success:${data}:${String(variables.rawInput)}`),
    onError: (error, variables) =>
      void events.push(`error:${String(error)}:${String(variables.rawInput)}`),
    onSettled: (data, error, variables) =>
      void events.push(`settled:${String(data)}:${String(error)}:${String(variables.rawInput)}`),
  });
  const flags = [run.isIdle, run.isPending, run.isSuccess, run.isError].map(Number).join("");
  return (
    <div>
      <button type="button" onClick={() => run.run(call)}>
        go
      </button>
      <p>flags:{flags}</p>
      <p>variables:{run.variables === undefined ? "-" : String(run.variables.rawInput)}</p>
    </div>
  );
}

function SettledOnly({ op, call, events }: {
  op: Operation.Handle<Promise<number>, number>;
  call: Scope.ProvideInput<number>;
  events: string[];
}): React.ReactElement {
  const push = (d: unknown, e: unknown, v: Scope.ProvideInput<number>): void => {
    events.push(`settled:${String(d)}:${String(e)}:${String(v.rawInput)}`);
  };
  const run = useRun(op, { onSettled: push });
  const sflags = [run.isSuccess, run.isError].map(Number).join("");
  return (
    <div>
      <button type="button" onClick={() => run.run(call)}>go</button>
      <p>sflags:{sflags}</p>
    </div>
  );
}

test("a run with only onSettled reports success without onSuccess", async () => {
  const scope = createScope();
  const events: string[] = [];
  const inc = operation({
    label: "inc-settled",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => Promise.resolve(input + 1),
  });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <SettledOnly op={inc} call={{ rawInput: "5" }} events={events} />
    </ScopeProvider>,
  );

  await screen.getByRole("button").click();
  await expect.element(screen.getByText("sflags:10")).toBeVisible();
  expect(events).toEqual(["settled:6:undefined:5"]);

  await scope.close();
});

test("a run with only onSettled reports failure without onError", async () => {
  const scope = createScope();
  const events: string[] = [];
  const failing = operation({
    label: "failing-settled",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => Promise.reject(new Error(`bad ${input}`)),
  });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <SettledOnly op={failing} call={{ rawInput: "7" }} events={events} />
    </ScopeProvider>,
  );

  await screen.getByRole("button").click();
  await expect.element(screen.getByText("sflags:01")).toBeVisible();
  expect(events).toEqual(["settled:undefined:Error: bad 7:7"]);

  await scope.close();
});

test("a run with empty options resolves runAsync without callbacks", async () => {
  const scope = createScope();
  const inc = operation({
    label: "inc-bare",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => Promise.resolve(input + 1),
  });

  let runAsync: Resolver | undefined;
  function Bare(): React.ReactElement {
    const run = useRun(inc, {});
    runAsync = run.runAsync;
    return <p>bare:{run.status === "success" ? String(run.data) : run.status}</p>;
  }

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Bare />
    </ScopeProvider>,
  );
  if (!runAsync) throw new Error("runAsync was not bound");

  await expect(runAsync({ rawInput: "5" })).resolves.toBe(6);
  await expect.element(screen.getByText("bare:6")).toBeVisible();

  await scope.close();
});

test("status flags and variables follow the latest call, and the option callbacks fire with it", async () => {
  const scope = createScope();
  const gate = deferred<void>();
  const events: string[] = [];
  const doubleAsync = operation({
    label: "doubleAsync",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => gate.promise.then(() => input * 2),
  });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Flags op={doubleAsync} call={{ rawInput: "21" }} events={events} />
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("flags:1000")).toBeVisible();
  await expect.element(screen.getByText("variables:-")).toBeVisible();
  await screen.getByRole("button").click();
  await expect.element(screen.getByText("flags:0100")).toBeVisible();
  await expect.element(screen.getByText("variables:21")).toBeVisible();
  gate.resolve();
  await expect.element(screen.getByText("flags:0010")).toBeVisible();
  expect(events).toEqual(["success:42:21", "settled:42:undefined:21"]);

  await scope.close();
});

test("onError and onSettled fire with the failure and the call", async () => {
  const scope = createScope();
  const events: string[] = [];
  const failing = operation({
    label: "failing",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => Promise.reject(new Error(`bad ${input}`)),
  });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Flags op={failing} call={{ rawInput: "7" }} events={events} />
    </ScopeProvider>,
  );

  await screen.getByRole("button").click();
  await expect.element(screen.getByText("flags:0001")).toBeVisible();
  expect(events).toEqual(["error:Error: bad 7:7", "settled:undefined:Error: bad 7:7"]);

  await scope.close();
});
