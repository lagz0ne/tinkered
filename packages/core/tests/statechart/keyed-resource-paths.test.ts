/**
 * Replays of the bug paths that the TLA+ model of ADR 0157 found
 * (/home/paseo/statechart/keyed-resource/report.md). One step per action.
 * A reader is what React's useData does:
 *   render    = scope.resolve(read), then reader.get()
 *   subscribe = reader.watch(fn)
 *   leave     = the stop that watch returned
 * Each `expect` is the ADR rule. A failing test means the bug is real.
 */
import { expect, test } from "vite-plus/test";

import { createScope, data, resource, tag } from "@/main";

const key = tag<string>({ label: "sc.key" });

/** One keyed resource on one source. Build n defers "end n"; it throws when `fail` is set. */
function setup(label: string) {
  const src = data({ label: `${label}.src`, initial: 0 });
  const log: string[] = [];
  const control = { fail: false, builds: 0 };
  const unit = resource({
    label,
    config: { k: key.required },
    depends: { src },
    factory: ({ src }, { defer }) => {
      const n = ++control.builds;
      log.push(`build ${n}`);
      if (control.fail) throw new Error(`build ${n} throws`);
      defer(() => void log.push(`end ${n}`));
      return src;
    },
  });
  return { src, log, control, unit };
}

/** A render: resolve, then get. A fault is the reader's to show; the test only steps. */
function renders(scope: ReturnType<typeof createScope>, read: unknown) {
  const reader = scope.resolve(read as never) as {
    get(): unknown;
    watch(fn: () => void): () => void;
  };
  try {
    reader.get();
  } catch {
    /* the entry holds a fault */
  }
  return reader;
}

test("EndsRunWhenScopeCloses (ADR 0157 d5): a rendered reader subscribes after the scope closed", async () => {
  const { src, log, control, unit } = setup("sc.three");
  const scope = createScope();

  // 1. the source changes
  scope.controller(src).set(1);
  // 2. reader 1 renders key A [no entry: a new one]; 3. the build throws
  control.fail = true;
  const one = renders(scope, unit({ k: "A" }));
  control.fail = false;
  // 4. the scope closes
  await scope.close();
  // 5. the reader subscribes [after the scope closed]; 6. the build finishes
  let threw = "";
  try {
    one.watch(() => undefined);
  } catch (error) {
    threw = (error as Error).message;
  }

  // ADR 0157 d5: an end runs when the scope closes. So no build's end may wait after it.
  const waiting = log
    .filter((l) => l.startsWith("build"))
    .slice(1) // build 1 threw before its defer
    .filter((l) => !log.includes(l.replace("build", "end")));
  expect({ threw, log, waiting }).toEqual({ threw: "Disposed", log: ["build 1"], waiting: [] });
});

test("EndWhenLastReaderLeaves (ADR 0157 d5): a reader that left subscribes again after the scope closed", async () => {
  const { src, log, control, unit } = setup("sc.four");
  const scope = createScope();

  // 1. the source changes
  scope.controller(src).set(1);
  // 2. reader 1 renders key A; 3. the build throws
  control.fail = true;
  const one = renders(scope, unit({ k: "A" }));
  control.fail = false;
  // 4. reader 1 subscribes; 5. reader 1 leaves
  one.watch(() => undefined)();
  // 6. the scope closes
  await scope.close();
  // 7. reader 1 subscribes again [after the scope closed]; 8. the build finishes
  try {
    one.watch(() => undefined);
  } catch {
    /* Disposed: reader 1 is not added */
  }

  // ADR 0157 d5: an end runs when the last reader leaves. Key A has no reader, so no end waits.
  const waiting = log
    .filter((l) => l.startsWith("build"))
    .slice(1)
    .filter((l) => !log.includes(l.replace("build", "end")));
  expect({ log, waiting }).toEqual({ log: ["build 1"], waiting: [] });
});
