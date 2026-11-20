/** Replays of the session-life model's bug paths (statechart/core3/session-life).
 * One block per model step. Each test asserts the ADR rule, so a failure shows the bug. */
import { expect, test } from "vite-plus/test";

import { capsule, createScope, operation, resource, type Scope } from "@/index";

function gate() {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

function closeHook(log: string[], wait?: Promise<void>) {
  return capsule({
    label: "hook",
    hooks: {
      close: async (event) => {
        log.push("close hook runs");
        if (wait) await wait;
        return event.next();
      },
    },
  });
}

/** A root resource whose defer logs the end it saw. */
function rootWork(log: string[]) {
  return resource({
    label: "root work",
    factory: (_deps, ctx) => {
      ctx.defer((end) => {
        log.push(`root defer: ${end.status}`);
      });
      return 1;
    },
  });
}

test("CloseHookRunsOnce: a root close from a session's defer runs the close hook once (ADR 0104)", async () => {
  const log: string[] = [];
  const root = createScope({ capsules: [closeHook(log)] });
  await root.ready;

  // 0. Root open, session body runs. Its defer calls root.close().
  let fromDefer: Promise<Scope.Result> | undefined;
  const flight = root.session((s) => {
    s.onClose(() => {
      fromDefer = root.close();
    });
    // 1. The session body returns: the session closes itself (forced).
    return "body done";
  });

  // 2. The forced close aborts the subtree. 3. The session's defer calls root.close().
  expect(await flight).toBe("body done");
  expect(fromDefer).toBeDefined();

  // 4. The forced root close aborts. 5. The root's defers run: closed cancelled.
  await fromDefer;
  await tick();

  // A later close() from the app gets the same close; the hook ran once.
  const later = await root.close();
  log.push(`root: ${later.status}`);

  expect(log).toEqual(["close hook runs", "root: cancelled"]);
});

test("FirstModeWins: a session's defer keeps the app's graceful root close graceful (ADR 0029 d1)", async () => {
  const log: string[] = [];
  const hookWait = gate();
  const root = createScope({ capsules: [closeHook(log, hookWait.promise)] });
  await root.ready;
  root.resolve(rootWork(log));

  // 0. Root open, session body runs. Its defer calls root.close().
  const flight = root.session((s) => {
    s.onClose(() => {
      void root.close();
    });
    // 1. The session body returns: the session closes itself (forced).
    return "body done";
  });

  // 2. The app calls root.close({ graceful: true }); the close hook waits.
  const closing = root.close({ graceful: true });

  // 3. The session's forced close aborts. 4. Its defer calls root.close().
  await flight;
  await tick();

  // The close hook calls next() and gets the close already under way.
  hookWait.release();
  const result = await closing;
  log.push(`root: ${result.status}`);

  expect(log).toEqual(["close hook runs", "root defer: success", "root: success"]);
});

test("HandleDeadAfterBody: a leaked session handle takes onClose after the body ended (ADR 0071 d1)", async () => {
  const log: string[] = [];
  const root = createScope({ capsules: [closeHook(log)] });
  await root.ready;
  const background = gate();
  const slow = operation({ label: "background", run: () => background.promise });
  const bodyGate = gate();

  // 0. Root open, session body runs. It starts owned work and keeps its handle.
  let leaked: Scope.Handle | undefined;
  const flight = root.session(async (s) => {
    leaked = s;
    void s.run(slow);
    await bodyGate.promise;
    return "body done";
  });

  // 1. The app calls root.close({ graceful: true }).
  const closing = root.close({ graceful: true });
  // 2. The close hook calls next(). 3. The close reaches the session.
  await tick();

  // 4. The session body returns. The graceful close waits for the owned work.
  bodyGate.release();
  await tick();

  // 5. Code calls onClose on the leaked handle.
  let refused = false;
  try {
    leaked!.onClose(() => {
      log.push("late defer ran");
    });
  } catch {
    refused = true;
  }

  background.release();
  await flight;
  await closing;

  expect(refused).toBe(true);
  expect(log).toEqual(["close hook runs"]);
});

test("control: with no ancestor close, the leaked handle is refused after the body", async () => {
  const root = createScope();
  const background = gate();
  const slow = operation({ label: "background", run: () => background.promise });

  let leaked: Scope.Handle | undefined;
  const flight = root.session(async (s) => {
    leaked = s;
    void s.run(slow).catch(() => undefined);
    return "body done";
  });
  await tick();

  expect(() => leaked!.onClose(() => undefined)).toThrow("Disposed");
  background.release();
  await flight.catch(() => undefined);
  await root.close();
});
