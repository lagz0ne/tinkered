import {
  createScope,
  data,
  makeTestClock,
  operation,
  resource,
  tag,
  type Scope,
} from "@tinker/core";

const region = tag<string>({ label: "region" });
const count = data({ label: "count", initial: 0 });

const doubled = operation({
  label: "doubled",
  depends: { n: count },
  run: ({ n }) => n * 2,
});

const store = resource({
  label: "store",
  factory: (_deps, { defer }) => {
    const rows: string[] = [];
    defer((end) => {
      if (end.status !== "success") rows.length = 0;
    });
    return { add: (row: string) => rows.push(row), size: () => rows.length };
  },
});

/** Time is an ambient capability on every ctx: `tour` injects a test clock at the scope, so this
 * reads a fixed instant (0) with no `Date.now` mock and no fake timers. */
const stamp = operation({
  label: "stamp",
  run: (_deps, { clock }) => clock.currentTimeMillis(),
});

/** Units are declared once; each tour owns its scope and reads its result before cleanup.
 * An inline body runs on the same call object with one span, and nothing is cached for it.
 * `scope.resolve` builds a resource once and reads that one instance after. */
export async function tour(): Promise<number> {
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    tags: [region("eu")],
    clock: makeTestClock({ now: 0 }),
  });
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
  }
  if (end.status === "failed") throw end.error;
  if (end.teardownErrors?.length) {
    const [error] = end.teardownErrors;
    throw error;
  }
  return total;
}
