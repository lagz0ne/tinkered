/** Hot-path budget (ADR 0016): a cached resolve allocates no promise. A count, not a clock, so
 * it holds on a busy box. The warm-read O(1)-in-depth promise is wall-clock, so it lives in the
 * timing lane `bench/warm-read.mjs`, run through the queue (tests/busy-host-flake). */
import { createHook } from "node:async_hooks";
import { expect, test } from "vite-plus/test";
import { createScope, resource } from "../src/index.ts";

test("a cached resource resolve allocates no promise on the hot path", () => {
  const conn = resource({ label: "conn", factory: () => ({ open: true }) });
  const ctl = createScope().controller(conn);
  ctl.resolve();
  let promises = 0;
  const hook = createHook({
    init: (_id, type) => {
      if (type === "PROMISE") promises++;
    },
  });
  hook.enable();
  for (let i = 0; i < 10_000; i++) ctl.resolve();
  hook.disable();
  expect(promises).toBe(0);
});
