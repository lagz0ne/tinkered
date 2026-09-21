import { operation, resource, tag, type Operation } from "@tinker/core";
import { command, type Cli } from "@tinker/cli";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findingLine,
  parseGraph,
  plainChecks,
  readCorpus,
  readTemplate,
  type Blueprint,
} from "./blueprint.ts";
import { raise } from "./errors.ts";

export { isError } from "./blueprint.ts";
export type { Errors } from "./blueprint.ts";
export { plainChecks, readBlueprint, readCorpus, readTemplate } from "./blueprint.ts";
export type { Blueprint } from "./blueprint.ts";

/** Where the templates live. Default: the shipped `corpus/` folder, resolved from
 * this module; a test rebinds it to a fixture. */
export const corpusPath: Tag.Handle<string> = tag({
  label: "corpusPath",
  default: new URL("../corpus/", import.meta.url).pathname,
});

/** The corpus resource: reads every `*.yaml` under `corpusPath` once per scope.
 * A bad template fails the build with `InvalidTemplate`. */
export const corpus: Resource.Handle<Blueprint.Corpus> = resource({
  label: "corpus",
  depends: { dir: corpusPath },
  factory: ({ dir }) => {
    const files = readdirSync(dir)
      .filter((file) => file.endsWith(".yaml"))
      .sort();
    return readCorpus(files.map((file) => readTemplate(readFileSync(join(dir, file), "utf8"), file)));
  },
});

/** One template block, verbatim: the id line, then each field on its own line. */
function verbatim(template: Blueprint.Template): string {
  const lines = [
    `id: ${template.id}`,
    `scope: ${template.scope}`,
    `applies: ${template.applies.join(", ")}`,
    `needs: ${template.needs.join(", ")}`,
    `status: ${template.status}`,
    `ask: ${template.ask}`,
  ];
  if (template.kind === "boolean") {
    lines.push(`true: ${template.true}`, `false: ${template.false}`);
  } else {
    for (const [option, meaning] of Object.entries(template.choices))
      lines.push(`${option}: ${meaning}`);
  }
  return lines.join("\n");
}

/** One template as a markdown list item: `- **id** — ask`, then indented field lines. */
function markdown(template: Blueprint.Template): string {
  const lines = [
    `- **${template.id}** — ${template.ask}`,
    `  applies: ${template.applies.join(", ")}`,
    `  needs: ${template.needs.join(", ")}`,
    `  status: ${template.status}`,
  ];
  if (template.kind === "boolean") {
    lines.push(`  true: ${template.true}`, `  false: ${template.false}`);
  } else {
    for (const [option, meaning] of Object.entries(template.choices))
      lines.push(`  ${option}: ${meaning}`);
  }
  return lines.join("\n");
}

/** Parse the raw argv into `explain` input: `--md` selects the markdown list. */
function parseExplain(raw: unknown): { md: boolean } {
  if (!Array.isArray(raw)) raise("InvalidBlueprint", { text: "", issues: [raw] });
  return { md: raw.includes("--md") };
}

/** The operation: input `{ md: boolean }`, depends `{ corpus }`, returns the templates
 * beside the flag — `respond` sees only the value, so the value carries what it needs. */
export const explain: Operation.Handle<
  { readonly md: boolean; readonly templates: readonly Blueprint.Template[] },
  { md: boolean }
> = operation({
  label: "explain",
  input: parseExplain,
  depends: { corpus },
  run: ({ corpus }, ctx) => ({ md: ctx.input.md, templates: corpus.templates }),
});

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
  command("explain", () => explain, {
    description: "print every template verbatim, or as a markdown list with --md",
    input: (argv) => argv,
    respond: (report) =>
      report.md
        ? `${report.templates.map(markdown).join("\n\n")}\n`
        : `${report.templates.map(verbatim).join("\n\n")}\n`,
  }),
];
