import { createScope, type Scope } from "@tinker/core";
import { makeTestClock } from "@tinker/core/testing";
import { count, doubled, region, stamp, store } from "./index";

if (import.meta.main) {
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    tags: [region("eu")],
    clock: makeTestClock({ now: 0 }),
  });
  const shutdown = (): void => stop.abort();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  let total: number;
  let end: Scope.Result;
  try {
    await scope.ready;
    const counter = scope.controller(count);
    counter.set(21);
    const seen: number[] = [];
    counter.watch((value) => seen.push(value));

    const twiceCount = scope.run(doubled);
    const inline = scope.run(
      { depends: { count }, run: ({ count }, { input }) => count + input },
      { input: 1 },
    );
    const rows = scope.resolve(store);
    rows.add("first");
    const time = scope.run(stamp);

    const inSession = await scope.session((child) => {
      child.controller(count).set(100);
      return child.run(doubled);
    });

    total = twiceCount + rows.size() + inSession + counter.get() + seen.length + time + inline;
  } finally {
    stop.abort();
    end = await scope.closed;
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
  }
  if (end.status === "failed") throw end.error;
  if (end.teardownErrors?.length) {
    const [error] = end.teardownErrors;
    throw error;
  }
  process.stdout.write(`Core example: ${total}\n`);
}
