// Replays steps 1 to 6 of the ReachesStable bug path of
// /home/paseo/statechart/react/session-provider (TLC counterexample), one step for each action.
// Steps 7 to 11 polled for the loop itself; Duke cut them (2026-11-19, option A).
// See docs/states/session-provider/README.md.
import type { Scope } from "@tinkered/core";
import { createScope, resource } from "@tinkered/core";
import { StrictMode, Suspense } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { ScopeProvider, SessionProvider, useResource } from "@/index";

/** Each build waits for the test to settle it, so "the session's data loads" is one step. */
const loads: Array<(value: string) => void> = [];

const data = resource({
  label: "data",
  target: "session",
  factory: () => new Promise<string>((resolve) => loads.push(resolve)),
});

function Child(): React.ReactElement {
  return <p>child:{useResource(data)}</p>;
}

test("ReachesStable: a SessionProvider inside Suspense under StrictMode reaches a stable state", async () => {
  const counts = { creates: 0, closes: 0 };
  const real = createScope();
  const scope = Object.assign(Object.create(real) as Scope.Handle, {
    createSession(options?: Scope.Options): Scope.Handle {
      counts.creates += 1;
      const session = real.createSession(options);
      session.onClose(() => {
        counts.closes += 1;
      });
      return session;
    },
  });
  const live = () => counts.creates - counts.closes;

  // 1. the page mounts the provider
  const screen = await render(
    <StrictMode>
      <ScopeProvider scope={scope}>
        <Suspense fallback={<p>fallback</p>}>
          <SessionProvider>
            <Child />
          </SessionProvider>
        </Suspense>
      </ScopeProvider>
    </StrictMode>,
  );
  // 2. the effect opens a session
  // 3. StrictMode closes the session and opens a new one
  await expect.poll(() => counts.creates).toBe(2);
  await expect.poll(live).toBe(1);
  // 4. the child asks for the session's data and suspends
  await expect.element(screen.getByText("fallback")).toBeVisible();
  await expect.poll(() => loads.length).toBe(1);
  // 5. the session's data loads
  loads[0]!("ok");
  // 6. the child shows again
  await expect.poll(() => document.body.textContent).toContain("child:ok");

  // The rule (ADR 0031; card react/strict-session-suspense: "renders ok with one build"):
  // once its data loaded, the provider stays on one session and one build.
  const record = { creates: counts.creates, builds: loads.length, live: live() };
  await screen.unmount();
  // A close waits for a build in flight; this test's builds ignore the abort, so settle them.
  for (const load of loads) load("late");
  await expect.poll(live).toBe(0);
  expect(record.creates).toBeLessThanOrEqual(2);
  expect({ builds: record.builds, live: record.live }).toEqual({ builds: 1, live: 1 });
});

test("control: without StrictMode the same tree is stable after one build (model: Strict = FALSE holds)", async () => {
  loads.length = 0;
  const counts = { creates: 0, closes: 0 };
  const real = createScope();
  const scope = Object.assign(Object.create(real) as Scope.Handle, {
    createSession(options?: Scope.Options): Scope.Handle {
      counts.creates += 1;
      const session = real.createSession(options);
      session.onClose(() => {
        counts.closes += 1;
      });
      return session;
    },
  });

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Suspense fallback={<p>fallback</p>}>
        <SessionProvider>
          <Child />
        </SessionProvider>
      </Suspense>
    </ScopeProvider>,
  );

  await expect.poll(() => loads.length).toBe(1);
  loads[0]!("ok");
  await expect.poll(() => document.body.textContent).toContain("child:ok");
  await new Promise((r) => setTimeout(r, 200));
  expect({ creates: counts.creates, builds: loads.length }).toEqual({ creates: 1, builds: 1 });

  await screen.unmount();
  await expect.poll(() => counts.creates - counts.closes).toBe(0);
});
