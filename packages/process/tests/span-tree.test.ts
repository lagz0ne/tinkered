import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { operation, type Observe } from "@tinker/core";
import { argv, io, jsonLine, run, type Process } from "../src/index.ts";

/** The operation the command drives: reads a file path from argv[0], guards the contents. */
const checkContents = operation({
  label: "checkContents",
  input: (raw: unknown) => {
    if (typeof raw !== "string" || raw.length === 0) throw new Error("need a file");
    return raw;
  },
  run: (_deps, ctx) => readFileSync(ctx.input, "utf8").length,
});

/** The `check` command, declared by its author: argv in, the file's length out, code owned. */
const checkCommand = operation({
  label: "check",
  depends: { argv: argv.required, io: io.required, check: checkContents },
  run: ({ argv: args, io: out, check: judge }) => {
    const length = judge.run({ rawInput: args[0] });
    out.write(jsonLine({ length }) ?? "");
    return 0;
  },
});

const shell: Process.Shell = {
  name: "tk",
  version: "0.0.0",
  commands: [{ name: "check", description: "judge one file", entry: () => ({ op: checkCommand }) }],
};

/** The span tree as `parent > child` lines, deepest last, in start order. */
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

test("the graph produces the trace: the command operation and the operation it drives beneath it", async () => {
  const seen: Observe.Span[] = [];
  const file = fileURLToPath(import.meta.url);
  const result = await run(
    {
      ...shell,
      commands: [
        {
          ...shell.commands[0],
          entry: () => ({
            op: checkCommand,
            options: { observe: { history: 10, export: (span) => seen.push(span) } },
          }),
        },
      ],
    },
    ["check", file],
  );
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ length: readFileSync(file, "utf8").length });
  expect(shape(seen)).toEqual(["check", "  checkContents"]);
});
