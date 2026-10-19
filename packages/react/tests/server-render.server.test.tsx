import type { Data, Operation, Resource, Scope } from "@tinker/core";
import { createScope, data, operation, resource } from "@tinker/core";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { renderToString } from "react-dom/server";
import { prerender } from "react-dom/static";
import { expect, test } from "vite-plus/test";

import { ScopeProvider, useData, useResource, useRun, type UseData } from "@/index";

import { deferred } from "./support/deferred";

function Raw({ cell }: { cell: Data.Cell<{ s: string }> }): ReactNode {
  return <p>{`raw:${useData(cell).s}`}</p>;
}

function Slice({ cell }: { cell: Data.Cell<{ s: string }> }): ReactNode {
  return <p>{`slice:${useData(cell, (v) => v.s.toUpperCase())}`}</p>;
}

function Pair({
  cell,
  keep,
}: {
  cell: Data.Cell<{ s: string }>;
  keep: (pair: UseData.Pair<{ s: string }, string>) => void;
}): ReactNode {
  const pair = useData(cell, (v) => v.s, { writable: true });
  keep(pair);
  return <p>{`pair:${pair[0]}`}</p>;
}

function Value({ handle }: { handle: Resource.Handle<number> }): ReactNode {
  return <p>{`value:${useResource(handle)}`}</p>;
}

function Local({ handle }: { handle: Resource.Handle<unknown> }): ReactNode {
  const q = useResource(handle, { suspense: false });
  return <p>{`${q.status}:${String(q.data)}`}</p>;
}

function Runner({
  op,
  keep,
}: {
  op: Operation.Handle<number, number>;
  keep: (runAsync: (...call: Scope.CallArgs<number>) => Promise<number>) => void;
}): ReactNode {
  const run = useRun(op);
  keep(run.runAsync);
  return <p>{`run:${run.status}`}</p>;
}

test("a server render reads data from the session it renders", async () => {
  const cell = data({ label: "cell", initial: { s: "init" } });
  const app = createScope();
  const session = app.createSession();
  session.controller(cell).set({ s: "sess" });
  let pair: UseData.Pair<{ s: string }, string> | undefined;

  const html = renderToString(
    <ScopeProvider scope={session}>
      <Raw cell={cell} />
      <Slice cell={cell} />
      <Pair cell={cell} keep={(p) => (pair = p)} />
    </ScopeProvider>,
  );

  expect(html).toContain("raw:sess");
  expect(html).toContain("slice:SESS");
  expect(html).toContain("pair:sess");

  pair?.[1]({ s: "next" });
  expect(session.resolve(cell)).toEqual({ s: "next" });
  expect(app.resolve(cell)).toEqual({ s: "init" });

  await session.close();
  await app.close();
});

test("a server render shows a built resource, and a suspending read waits for an async build", async () => {
  const sync = resource({ label: "sync", factory: () => 7 });
  const gate = deferred<number>();
  const slow = resource({ label: "slow", factory: () => gate.promise });
  const scope = createScope();

  expect(
    renderToString(
      <ScopeProvider scope={scope}>
        <Value handle={sync} />
      </ScopeProvider>,
    ),
  ).toContain("value:7");

  const rendering = prerender(
    <ScopeProvider scope={scope}>
      <Suspense fallback={<p>wait</p>}>
        <Value handle={slow} />
      </Suspense>
    </ScopeProvider>,
  );
  gate.resolve(9);
  const html = await new Response((await rendering).prelude).text();

  expect(html).toContain("value:9");

  await scope.close();
});

test("a server render of a non-suspending read shows success or pending", async () => {
  const sync = resource({ label: "sync", factory: () => 3 });
  const gate = deferred<number>();
  const slow = resource({ label: "slow", factory: () => gate.promise });
  const scope = createScope();

  const html = renderToString(
    <ScopeProvider scope={scope}>
      <Local handle={sync} />
      <Local handle={slow} />
    </ScopeProvider>,
  );

  expect(html).toContain("success:3");
  expect(html).toContain("pending:undefined");

  gate.resolve(0);
  await scope.close();
});

test("a server render shows an idle run, and the run still works after the render", async () => {
  const double = operation({
    label: "double",
    input: (raw) => Number(raw),
    run: (_deps, { input }) => input * 2,
  });
  const scope = createScope();
  let runAsync: ((...call: Scope.CallArgs<number>) => Promise<number>) | undefined;

  const html = renderToString(
    <ScopeProvider scope={scope}>
      <Runner op={double} keep={(r) => (runAsync = r)} />
    </ScopeProvider>,
  );

  expect(html).toContain("run:idle");
  await expect(runAsync?.({ rawInput: "21" })).resolves.toBe(42);

  await scope.close();
});
