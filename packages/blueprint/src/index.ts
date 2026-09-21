import { operation, resource, tag, type Operation, type Resource, type Tag } from "@tinker/core";
import { command, type Cli } from "@tinker/cli";
import {
  createGateway,
  experimental_evaluate as evaluate,
  type Experimental_EvaluationModel as EvaluationModel,
} from "ai";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findingLine,
  goldenCasesOf,
  gradeTemplate,
  parseCheckInput,
  readBlueprint,
  readCorpus,
  readEval,
  readTemplate,
  runCheck,
  type Blueprint,
} from "./blueprint.ts";
import { raise } from "./errors.ts";

export { isError } from "./blueprint.ts";
export type { Errors } from "./blueprint.ts";
export {
  gradeTemplate,
  plainChecks,
  readBlueprint,
  readCorpus,
  readEval,
  readTemplate,
} from "./blueprint.ts";
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

/** Where the evals live. Default: the shipped `evals/` folder, resolved from
 * this module; a test rebinds it to a fixture. */
export const evalsPath: Tag.Handle<string> = tag({
  label: "evalsPath",
  default: new URL("../evals/", import.meta.url).pathname,
});

/** One template id's evals, read off disk. Empty when the id has no `bad` or `clean` folder. */
function readEvalFiles(folder: string): readonly Blueprint.Eval[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((file) => file.endsWith(".yaml"))
    .sort()
    .map((file) => readEval(readFileSync(join(folder, file), "utf8"), join(folder, file)));
}

/** `evalsPath/golden.yaml`, parsed as a plain blueprint (not an eval file) — a known-clean
 * design every template also grades against. `undefined` when the folder ships none. */
function readGolden(dir: string): Blueprint.Graph | undefined {
  const file = join(dir, "golden.yaml");
  return existsSync(file) ? readBlueprint(readFileSync(file, "utf8")) : undefined;
}

/** The eval-set resource: reads `evalsPath/<id>/{bad,clean}/*.yaml` once per scope into a
 * map keyed by template id, plus `golden.yaml`'s cases for every template it applies to
 * (ADR 0052 decision 5, amended). A bad eval file fails the build with `InvalidEval`. */
export const evalSet: Resource.Handle<
  ReadonlyMap<
    string,
    {
      readonly bad: readonly Blueprint.Eval[];
      readonly clean: readonly Blueprint.Eval[];
      readonly golden: readonly Blueprint.Eval[];
    }
  >
> = resource({
  label: "evalSet",
  depends: { dir: evalsPath, corpus },
  factory: ({ dir, corpus }) => {
    const golden = readGolden(dir);
    const ids = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    return new Map(
      ids.map((id) => {
        const template = corpus.templates.find((candidate) => candidate.id === id);
        return [
          id,
          {
            bad: readEvalFiles(join(dir, id, "bad")),
            clean: readEvalFiles(join(dir, id, "clean")),
            golden: template && golden ? goldenCasesOf(template, golden, "golden.yaml") : [],
          },
        ];
      }),
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

/** The operation: no input, depends `{ corpus, judge, evalSet }`, grades every shipped
 * template against its evals (ADR 0052 decision 5). Same code path `blueprint evals` prints. */
export const evals: Operation.Handle<Promise<readonly Blueprint.Grade[]>, void> = operation({
  label: "evals",
  depends: { corpus, judge, evalSet },
  run: async ({ corpus, judge, evalSet }, ctx) => {
    const grades: Blueprint.Grade[] = [];
    for (const template of corpus.templates) {
      const set = evalSet.get(template.id) ?? { bad: [], clean: [], golden: [] };
      grades.push(await gradeTemplate(template, set, judge, ctx.signal));
    }
    return grades;
  },
});

/** A share, as a rounded percent: `0.755` reads `76%`. */
function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** The middle value, sorted ascending; `NaN` with nothing to average. */
function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** One grade as a line: `✓` proven, `~` provisional, `✗` noisy, then the numbers behind it,
 * including how many of the golden design's cases it hit. */
function gradeLine(grade: Blueprint.Grade, idWidth: number): string {
  const mark = grade.status === "proven" ? "✓" : grade.status === "noisy" ? "✗" : "~";
  return (
    `${mark} ${grade.id.padEnd(idWidth)}  ${grade.status.padEnd(11)}` +
    `  bad ${grade.bad.length} (med ${pct(medianOf(grade.bad))})` +
    `  clean ${grade.clean.length} (med ${pct(medianOf(grade.clean))})` +
    `  sep ${pct(grade.sep)}  ordered ${pct(grade.ordered)}` +
    `  golden ${grade.goldenHits.length}/${grade.goldenTotal}`
  );
}

/** One line per template's grade, widest id first so the columns line up. */
function evalsLines(grades: readonly Blueprint.Grade[]): string {
  const idWidth = Math.max(0, ...grades.map((grade) => grade.id.length));
  return `${grades.map((grade) => gradeLine(grade, idWidth)).join("\n")}\n`;
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
  command("evals", () => evals, {
    description: "grade every template against its evals with the judge (needs a key)",
    respond: evalsLines,
  }),
];
