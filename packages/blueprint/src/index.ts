import { operation, type Operation } from "@tinker/core";
import { command, type Cli } from "@tinker/cli";
import { readFileSync } from "node:fs";
import { findingLine, parseGraph, plainChecks, type Blueprint } from "./blueprint.ts";
import { raise } from "./errors.ts";

export { isError } from "./blueprint.ts";
export type { Errors } from "./blueprint.ts";
export { plainChecks, readBlueprint } from "./blueprint.ts";
export type { Blueprint } from "./blueprint.ts";

/** The operation: input = the file text (parse = readBlueprint), returns the
 * report. Throws `BlueprintRejected { findings }` when any finding blocks —
 * the cli maps a throw to exit 1 with the message on stderr, and the message is
 * the finding lines, one per line. */
export const check: Operation.Handle<Blueprint.Report, Blueprint.Graph> = operation({
  label: "check",
  input: parseGraph,
  run: (_deps, ctx) => {
    const findings = plainChecks(ctx.input);
    if (findings.some((finding) => finding.blocking))
      raise(
        "BlueprintRejected",
        { findings: findings.map(findingLine) },
        findings.map(findingLine).join("\n"),
      );
    return { nodes: ctx.input.nodes.length, findings };
  },
});

/** The wiring row for the cli: `input` reads argv[0] from disk (the process
 * edge, at the root), `respond` prints one line per finding or `ok: N nodes`. */
export const commands: Cli.Row[] = [
  command("check", () => check, {
    description: "run the plain checks over one blueprint file",
    input: (argv) => readFileSync(argv[0] ?? "", "utf8"),
    respond: (report) =>
      report.findings.length === 0
        ? `ok: ${report.nodes} nodes\n`
        : `${report.findings.map(findingLine).join("\n")}\n`,
  }),
];
