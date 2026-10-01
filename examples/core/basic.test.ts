import { createScope, makeTestClock } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { count, doubled, region, stamp, store } from "./index.ts";

test("a child session changes its own count without changing the root's count", async () => {
  const stop = new AbortController();
  const root = createScope({ signal: stop.signal });
  try {
    await root.ready;
    root.controller(count).set(21);
    expect(
      await root.session((child) => {
        child.controller(count).set(100);
        return child.run(doubled);
      }),
    ).toBe(200);
    expect(root.run(doubled)).toBe(42);
  } finally {
    stop.abort();
    await root.closed;
  }
});

test("an inline call reads tags, data, and its input", async () => {
  const stop = new AbortController();
  const root = createScope({ signal: stop.signal, tags: region("eu") });
  try {
    await root.ready;
    root.controller(count).set(21);
    expect(
      root.run(
        {
          depends: { count, region },
          run: ({ count, region }, { input }) => `${region}:${count + input}`,
        },
        { input: 1 },
      ),
    ).toBe("eu:22");
  } finally {
    stop.abort();
    await root.closed;
  }
});

test("reading the store again keeps its rows", async () => {
  const stop = new AbortController();
  const root = createScope({ signal: stop.signal });
  try {
    await root.ready;
    root.resolve(store).add("first");
    expect(root.resolve(store).size()).toBe(1);
  } finally {
    stop.abort();
    await root.closed;
  }
});

test("stamp reads the clock supplied by the root", async () => {
  const stop = new AbortController();
  const root = createScope({ signal: stop.signal, clock: makeTestClock({ now: 7 }) });
  try {
    await root.ready;
    expect(root.run(stamp)).toBe(7);
  } finally {
    stop.abort();
    await root.closed;
  }
});
