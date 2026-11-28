import { createScope, type Scope } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";

import { basic } from "./index";

if (import.meta.main) {
  const stop = new AbortController();
  const app = basic({ region: "eu" });
  const scope = createScope({
    signal: stop.signal,
    clock: makeTestClock({ now: 0 }),
    capsules: [app],
  });

  const shutdown = (): void => stop.abort();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  let total: number;
  let place: string;
  let end: Scope.Result;
  try {
    await scope.ready;
    const count = scope.resolve(app.count);
    const seen: number[] = [];
    count.watch(() => seen.push(count.get()));
    await scope.run(app.setCount, { input: 21 });

    const twice = await scope.run(app.doubled);
    place = await scope.run(app.where);
    const rows = scope.resolve(app.store);
    rows.add("first");
    const time = await scope.run(app.stamp);

    const inSession = await scope.session(async (child) => {
      await child.run(app.setCount, { input: 100 });
      return child.run(app.doubled);
    });

    total = twice + rows.size() + inSession + count.get() + seen.length + time;
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

  process.stdout.write(`Core example: ${total} (${place})\n`);
}
