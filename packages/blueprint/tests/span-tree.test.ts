import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { preset, type Observe } from "@tinker/core";
import { run } from "@tinker/process";
import { corpusPath, judge, shell, type Blueprint } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const trackerPath = join(here, "..", "examples", "tracker.yaml");
const provisionalCorpus = join(here, "fixtures", "corpus-provisional");
const no: Blueprint.Answer = { type: "boolean", probability: 0 };

/** The span tree as indented `name` lines, in start order (ADR 0058). */
function shape(spans: readonly Observe.Span[]): string[] {
  const byId = new Map(spans.map((span) => [span.id, span]));
  const depth = (span: Observe.Span): number => {
    let n = 0;
    for (let at = span.parentId; at !== undefined; at = byId.get(at)?.parentId) n += 1;
    return n;
  };
  return [...spans]
    .sort((a, b) => a.id - b.id)
    .map((span) => `${"  ".repeat(depth(span))}${span.name}`);
}

test("a check run's trace shows the command, the operation it drives, and the resources it built", async () => {
  const seen: Observe.Span[] = [];
  const result = await run(
    shell({
      tags: [corpusPath(provisionalCorpus)],
      presets: [preset(judge, () => ({ ask: () => Promise.resolve(no) }) as never)],
      observe: { history: 100, export: (span) => seen.push(span) },
    }),
    ["check", trackerPath],
  );
  expect(result.code).toBe(0);
  expect(shape(seen)).toEqual(["check", "  check", "    corpus", "    judge"]);
});
