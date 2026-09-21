import { operation, resource, tag, type Operation, type Resource, type Tag } from "@tinker/core";
import { command, type Cli } from "@tinker/cli";
import {
  createGateway,
  experimental_evaluate as evaluate,
  type Experimental_EvaluationModel as EvaluationModel,
} from "ai";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findingLine,
  parseCheckInput,
  readCorpus,
  readTemplate,
  runCheck,
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
    return readCorpus(
      files.map((file) => readTemplate(readFileSync(join(dir, file), "utf8"), file)),
    );
  },
});

/** The Jev engine: which model, which key. Bound at the root when a key exists;
 * a test never binds it — `judge` takes it as `engine.optional`. */
export const engine: Tag.Handle<Blueprint.Engine> = tag({ label: "engine" });

/** True on a Jev rate-limit error message. */
const RATE_LIMITED = /rate|429/i;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One `setTimeout`, awaited, cleared when `signal` aborts — nothing outlives the call. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** One `evaluate` call, with 429 backoff: wait `8000 * (attempt + 1)` ms and retry, 5 tries,
 * then throw. Any other error throws as-is. */
async function askGateway(
  model: EvaluationModel,
  state: Blueprint.NodeState | Blueprint.PairState,
  questions: Readonly<Record<string, Blueprint.Question>>,
  signal: AbortSignal,
): Promise<Readonly<Record<string, Blueprint.Answer>>> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { answers } = await evaluate({ model, state, questions, abortSignal: signal });
      return answers;
    } catch (error: unknown) {
      if (!RATE_LIMITED.test(messageOf(error))) throw error;
      await wait(8000 * (attempt + 1), signal);
    }
  }
  raise("JevUnavailable", {}, "blueprint: gave up after rate-limit retries");
}

/** One Jev client per scope. With no engine bound, the build fails `NoKey`. */
export const judge: Resource.Handle<Blueprint.Judge> = resource({
  label: "judge",
  depends: { engine: engine.optional },
  factory: ({ engine: bound }) => {
    if (!bound.present)
      raise("NoKey", {}, "blueprint: no key (set AI_GATEWAY_API_KEY or --key-file <path>)");
    const model = createGateway({ apiKey: bound.value.apiKey }).evaluationModel(bound.value.model);
    return {
      ask: (state, questions, signal) => askGateway(model, state, questions, signal),
    };
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
    lines.push(
      `kind: boolean`,
      `threshold: ${template.threshold}`,
      `true: ${template.true}`,
      `false: ${template.false}`,
    );
  } else {
    lines.push(`kind: choice`, `minConfidence: ${template.minConfidence}`);
    if (template.compare !== undefined) lines.push(`compare: ${template.compare}`);
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
    if (template.compare !== undefined) lines.push(`  compare: ${template.compare}`);
    for (const [option, meaning] of Object.entries(template.choices))
      lines.push(`  ${option}: ${meaning}`);
  }
  return lines.join("\n");
}

/** Read the call input into the flag: anything without a true `md` reads as false. */
function parseMd(raw: unknown): { md: boolean } {
  return {
    md: typeof raw === "object" && raw !== null && "md" in raw && raw.md === true,
  };
}

/** The operation: input `{ md: boolean }`, depends `{ corpus }`, returns the templates
 * beside the flag — `respond` sees only the value, so the value carries what it needs. */
export const explain: Operation.Handle<
  { readonly md: boolean; readonly templates: readonly Blueprint.Template[] },
  { md: boolean }
> = operation({
  label: "explain",
  input: parseMd,
  depends: { corpus },
  run: ({ corpus }, ctx) => ({ md: ctx.input.md, templates: corpus.templates }),
});

/** The operation: input `{ graph, json }`, depends `{ corpus, judge }`, returns the report
 * beside the flag — `respond` sees only the value, so the value carries what it needs (as
 * `explain` above). Throws `BlueprintRejected { findings }` when any finding blocks — the
 * cli maps a throw to exit 1 with the message on stderr, and the message is the finding
 * lines, one per line. */
export const check: Operation.Handle<
  Promise<{ readonly json: boolean; readonly report: Blueprint.Report }>,
  { readonly graph: Blueprint.Graph; readonly json: boolean }
> = operation({
  label: "check",
  input: parseCheckInput,
  depends: { corpus, judge },
  run: async ({ corpus, judge }, ctx) => {
    const report = await runCheck(ctx.input.graph, corpus, judge, ctx.signal);
    if (report.findings.some((finding) => finding.blocking))
      raise(
        "BlueprintRejected",
        { findings: report.findings.map(findingLine) },
        report.findings.map(findingLine).join("\n"),
      );
    return { json: ctx.input.json, report };
  },
});

/** One line per finding, then `ok: N nodes, M findings`. */
function checkLines(report: Blueprint.Report): string {
  const lines = [
    ...report.findings.map(findingLine),
    `ok: ${report.nodes} nodes, ${report.findings.length} findings`,
  ];
  return `${lines.join("\n")}\n`;
}

/** The first argv entry that is not a flag and is not `--key-file`'s value. */
function fileArg(argv: readonly string[]): string | undefined {
  return argv.find((arg, i) => !arg.startsWith("--") && argv[i - 1] !== "--key-file");
}

/** The wiring row for the cli: `input` reads the named file off disk (the process
 * edge, at the root) beside the `--json` flag; `respond` prints the lines or,
 * with `--json`, the report as one JSON object. */
export const commands: Cli.Row[] = [
  command("check", () => check, {
    description: "judge one blueprint file with Jev over the shipped question templates",
    input: (argv) => ({
      text: readFileSync(fileArg(argv) ?? "", "utf8"),
      json: argv.includes("--json"),
    }),
    respond: ({ json, report }) => (json ? `${JSON.stringify(report)}\n` : checkLines(report)),
  }),
  command("explain", () => explain, {
    description: "print every template verbatim, or as a markdown list with --md",
    input: (argv) => ({ md: argv.includes("--md") }),
    respond: (report) =>
      report.md
        ? `${report.templates.map(markdown).join("\n\n")}\n`
        : `${report.templates.map(verbatim).join("\n\n")}\n`,
  }),
];
