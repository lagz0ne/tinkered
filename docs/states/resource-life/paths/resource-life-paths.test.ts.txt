// Replays the bug paths of the ResourceLife model (/home/paseo/statechart/core2/resource-life),
// one step per model action. Each test asserts the ADR rule; a failure means the model's path
// reproduces on the real code.
import { expect, test } from "vite-plus/test";

import { createScope, isError, resource, type Resource } from "@/index";

/** A reads B. Both factories take ctx and defer one end. A's first build throws. */
function pair(ended: string[]) {
  let builds = 0;
  const b = resource({
    label: "life.b",
    factory: (_deps, ctx) => {
      ctx.defer((end) => void ended.push(`b:${end.status}`));
      return "b";
    },
  });
  const a = resource({
    label: "life.a",
    depends: { b },
    factory: (_deps, ctx) => {
      builds++;
      const build = builds;
      ctx.defer((end) => void ended.push(`a${build}:${end.status}`));
      if (build === 1) throw new Error("a build 1 fails");
      return "a";
    },
  });
  return { a, b };
}

test("GoodBuildReleaseEndsReleased path: a good build after a failed one ends released (ADR 0063 d3)", () => {
  const ended: string[] = [];
  const { a } = pair(ended);
  const scope = createScope();

  // 1. you resolve A: B builds, A's factory throws
  expect(() => scope.resolve(a)).toThrow("a build 1 fails");
  // no rule yet: the failed build's end has not run
  expect(ended).toEqual([]);
  // 2. you resolve A: it builds
  expect(scope.resolve(a)).toBe("a");
  // 3. you release A
  scope.release(a);
  // 4. the released ends run (sync ends run inside release)
  expect(ended).toContain("a2:released");
});

test("GoodBuildCloseEndsWithClose path: a good build after a failed one ends with the close (ADR 0063 d6)", async () => {
  const ended: string[] = [];
  const { a } = pair(ended);
  const scope = createScope();

  // 1. you resolve A: B builds, A's factory throws
  expect(() => scope.resolve(a)).toThrow("a build 1 fails");
  // 2. you resolve A: it builds
  expect(scope.resolve(a)).toBe("a");
  // 3. you call close()
  const result = await scope.close();
  // 4. an instance's ends run
  expect(ended).toContain(`b:${result.status}`);
  expect(ended).toContain(`a2:${result.status}`);
});

test("CloseResolves path: A and B read each other; close() resolves (ADR 0027)", async () => {
  const depends: Record<string, Resource.Handle<unknown>> = {};
  const b = resource({ label: "cycle.b", depends, factory: (_deps, _ctx) => "b" });
  const a = resource({ label: "cycle.a", depends: { b }, factory: (_deps, _ctx) => "a" });
  depends.a = a;
  const scope = createScope();

  // 1. you resolve A: CircularResource (B reads A)
  let thrown: unknown;
  try {
    scope.resolve(a);
  } catch (error) {
    thrown = error;
  }
  if (!isError(thrown, "CircularResource")) throw thrown;
  // 2. you call close()
  const closed = scope.close().then((result) => result.status);
  const late = new Promise((resolve) => setTimeout(() => resolve("still open after 500 ms"), 500));
  expect(await Promise.race([closed, late])).not.toBe("still open after 500 ms");
});
