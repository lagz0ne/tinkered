// Replays of the UseRun model (statechart/core4/react-run-resource/UseRun.tla):
// each test runs one model path, one step per action, on the real code.
import { createScope, operation } from "@tinkered/core";
import { Suspense, use, useState } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";

import type { Run } from "@/index";
import { ScopeProvider, useRun } from "@/index";

/** A promise a test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const tick = () => new Promise((done) => setTimeout(done, 30));

function setup() {
  const gate = deferred<number>();
  const op = operation({ label: "slow", run: () => gate.promise });
  const seen: string[] = [];
  const handle: { run?: Run.Handle<number, void> } = {};

  function Runner(): React.ReactElement {
    const run = useRun(op, { onSuccess: (v) => void seen.push(`onSuccess ${v}`) });
    handle.run = run;
    return <p>status:{run.status}</p>;
  }
  return { gate, seen, handle, Runner };
}

/** Suspends on `hold` until `release`: its Suspense boundary hides the shown siblings. */
const holder: { hold: Promise<void>; release: () => void } = {
  hold: Promise.resolve(),
  release: () => undefined,
};

function Hider(): null {
  use(holder.hold);
  return null;
}

function Page({ Runner }: { Runner: () => React.ReactElement }): React.ReactElement {
  const [hidden, setHidden] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setHidden(true)}>
        hide
      </button>
      <Suspense fallback={<p>loading</p>}>
        <Runner />
        {hidden ? <Hider /> : null}
      </Suspense>
    </>
  );
}

const hold = () => {
  const d = deferred<void>();
  holder.hold = d.promise;
  holder.release = () => d.resolve();
};

test("ShownStateIsLatest path: a Suspense hide and show clears a pending run to idle", async () => {
  const app = setup();
  const scope = createScope();
  hold();
  const screen = await render(
    <ScopeProvider scope={scope}>
      <Page Runner={app.Runner} />
    </ScopeProvider>,
  );

  // 1. You run: pending.
  app.handle.run!.run();
  await expect.element(screen.getByText("status:pending")).toBeInTheDocument();
  // 2. A Suspense above hides it.
  await screen.getByRole("button", { name: "hide" }).click();
  await expect.element(screen.getByText("loading")).toBeInTheDocument();
  // 3. The layout effect runs again (show).
  holder.release();
  await expect.element(screen.getByText(/^status:/)).toBeVisible();
  await tick();

  // ADR 0032 d2: the state is the latest call's: still pending.
  expect(app.handle.run!.status).toBe("pending");
  app.gate.resolve(1);
});

test("CallbacksFirePerRun path: a run that settles while a Suspense hides it fires no onSuccess", async () => {
  const app = setup();
  const scope = createScope();
  hold();
  const screen = await render(
    <ScopeProvider scope={scope}>
      <Page Runner={app.Runner} />
    </ScopeProvider>,
  );

  // 1. You run.
  const answer = app.handle.run!.runAsync();
  // 2. A Suspense above hides it.
  await screen.getByRole("button", { name: "hide" }).click();
  await expect.element(screen.getByText("loading")).toBeInTheDocument();
  // 3. The run settles.
  app.gate.resolve(7);
  expect(await answer).toBe(7);
  await tick();
  holder.release();

  // ADR 0032 d2: onSuccess/onError/onSettled fire per run.
  expect(app.seen).toEqual(["onSuccess 7"]);
});

test("CallbacksFirePerRun, unmount: a run that settles after unmount fires no onSuccess", async () => {
  const app = setup();
  const scope = createScope();
  const screen = await render(
    <ScopeProvider scope={scope}>
      <app.Runner />
    </ScopeProvider>,
  );

  // 1. You run.
  const answer = app.handle.run!.runAsync();
  // 2. It unmounts.
  await screen.unmount();
  // 3. The run settles: the caller of runAsync still gets the value.
  app.gate.resolve(5);
  expect(await answer).toBe(5);
  await tick();

  // ADR 0032 d2: onSuccess/onError/onSettled fire per run.
  expect(app.seen).toEqual(["onSuccess 5"]);
});
