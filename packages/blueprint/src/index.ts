import {
  operation,
  resource,
  tag,
  type Operation,
  type Resource,
  type Scope,
  type Tag,
} from "@tinker/core";
import { command, type Process } from "@tinker/process";
import {
  createGateway,
  experimental_evaluate as evaluate,
  type Experimental_EvaluationModel as EvaluationModel,
} from "ai";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  bodyFindings,
  findingLine,
  goldenCasesOf,
  gradeTemplate,
  median,
  parseCheckInput,
  parseSuggestInput,
  parseVerifyInput,
  readBlueprint,
  readCorpus,
  readEval,
  readTemplate,
  runCheck,
  templateQuestion,
  verifyChecks,
  type Blueprint,
} from "./blueprint.ts";
import { raise } from "./errors.ts";
import { readUnits } from "./extract.ts";

export { isError } from "./blueprint.ts";
export type { Errors } from "./blueprint.ts";
export {
  goldenCasesOf,
  gradeTemplate,
  median,
  plainChecks,
  readBlueprint,
  readCorpus,
  readEval,
  readTemplate,
  verifyChecks,
} from "./blueprint.ts";
export { readUnits } from "./extract.ts";
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

/** The package's own golden pair (ADR 0055 §5): `blueprint.yaml` and `src/`, resolved next to
 * this module, as the `verify` cli row resolves them from argv. `undefined` when either is
 * missing — the shipped `dist` build carries no `src` (`package.json`'s `files`), so an
 * installed package grades a `body` template with no golden pair. */
function readOwnPair():
  | { readonly graph: Blueprint.Graph; readonly units: readonly Blueprint.Unit[] }
  | undefined {
  const file = new URL("../blueprint.yaml", import.meta.url).pathname;
  const dir = new URL("../src/", import.meta.url).pathname;
  if (!existsSync(file) || !existsSync(dir)) return undefined;
  return { graph: readBlueprint(readFileSync(file, "utf8")), units: walk(dir) };
}

/** The eval-set resource: reads `evalsPath/<id>/{bad,clean}/*.yaml` once per scope into a
 * map keyed by template id, plus golden cases for every template it applies to (ADR 0052
 * decision 5, amended): `golden.yaml`'s for every template, and, for a `body` template only,
 * the package's own golden pair's (ADR 0055 §5 — `goldenCasesOf` resolves each case's `body`
 * from `ownPair.units`). A bad eval file fails the build with `InvalidEval`. */
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
    const needsBody = corpus.templates.some((template) => template.needs.includes("body"));
    const ownPair = needsBody ? readOwnPair() : undefined;
    const ids = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    return new Map(
      ids.map((id) => {
        const template = corpus.templates.find((candidate) => candidate.id === id);
        const needsBodyGolden = template !== undefined && template.needs.includes("body");
        return [
          id,
          {
            bad: readEvalFiles(join(dir, id, "bad")),
            clean: readEvalFiles(join(dir, id, "clean")),
            golden: [
              ...(template && golden ? goldenCasesOf(template, golden, "golden.yaml") : []),
              ...(template && needsBodyGolden && ownPair
                ? goldenCasesOf(template, ownPair.graph, "blueprint.yaml", ownPair.units)
                : []),
            ],
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
  state: Blueprint.NodeState | Blueprint.PairState | Blueprint.WordsState,
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

/** One Jev client over a bound engine — `judge`'s factory, and `bodyJudge`'s below. */
function judgeFrom(engineValue: Blueprint.Engine): Blueprint.Judge {
  const model = createGateway({ apiKey: engineValue.apiKey }).evaluationModel(engineValue.model);
  return { ask: (state, questions, signal) => askGateway(model, state, questions, signal) };
}

/** One Jev client per scope. With no engine bound, the build fails `NoKey`. */
export const judge: Resource.Handle<Blueprint.Judge> = resource({
  label: "judge",
  depends: { engine: engine.optional },
  factory: ({ engine: bound }) => {
    if (!bound.present)
      raise("NoKey", {}, "blueprint: no key (set AI_GATEWAY_API_KEY or --key-file <path>)");
    return judgeFrom(bound.value);
  },
});

/** The Jev client `verify` asks `body` templates with, `undefined` with no engine bound — unlike
 * `judge`, this never fails `NoKey`: `verify` stays useful with no key (ADR 0055 §4). A
 * resource carries no `.optional` edge, so this is `verify`'s own way to make the engine
 * optional; a test presets it directly with a fake. */
export const bodyJudge: Resource.Handle<Blueprint.Judge | undefined> = resource({
  label: "bodyJudge",
  depends: { engine: engine.optional },
  factory: ({ engine: bound }) => (bound.present ? judgeFrom(bound.value) : undefined),
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
    for (const [option, meaning] of Object.entries(template.choices)) {
      lines.push(`${option}: ${meaning}`);
      const shape = template.shapes?.[option];
      if (shape !== undefined) lines.push(`shape.${option}: ${shape}`);
    }
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
    for (const [option, meaning] of Object.entries(template.choices)) {
      lines.push(`  ${option}: ${meaning}`);
      const shape = template.shapes?.[option];
      if (shape !== undefined) lines.push(`  shape.${option}: ${shape}`);
    }
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

/** The operation: input `{ graph, units, json }`, depends `{ corpus, bodyJudge }` — a plain diff
 * between a blueprint file and the code's declared units (ADR 0055 §2, §3), plus one
 * `judge.ask` per node for every applicable `body` template when `bodyJudge` is present (§4).
 * `verify` never depends on `judge`: that resource fails `NoKey` with none, but `verify` stays
 * useful without a key, skipping the body templates instead. Throws `BlueprintRejected` when
 * any finding blocks: every plain finding does; a body-template hit blocks only past `proven`
 * (as `check`). */
export const verify: Operation.Handle<
  Promise<{
    readonly json: boolean;
    readonly report: Blueprint.VerifyReport;
    readonly bodySkipped: boolean;
  }>,
  {
    readonly graph: Blueprint.Graph;
    readonly units: readonly Blueprint.Unit[];
    readonly json: boolean;
  }
> = operation({
  label: "verify",
  input: parseVerifyInput,
  depends: { corpus, bodyJudge },
  run: async ({ corpus, bodyJudge }, ctx) => {
    const plain = verifyChecks(ctx.input.graph, ctx.input.units);
    const body =
      bodyJudge === undefined
        ? []
        : await bodyFindings(ctx.input.graph, ctx.input.units, corpus, bodyJudge, ctx.signal);
    const findings = [...plain, ...body];
    const report: Blueprint.VerifyReport = {
      nodes: ctx.input.graph.nodes.length,
      units: ctx.input.units.length,
      findings,
    };
    if (findings.some((finding) => finding.blocking))
      raise(
        "BlueprintRejected",
        { findings: findings.map(findingLine) },
        findings.map(findingLine).join("\n"),
      );
    return { json: ctx.input.json, report, bodySkipped: bodyJudge === undefined };
  },
});

/** One line per finding, then `ok: N nodes, M units, K findings`, then — with no engine bound —
 * `body templates skipped: no key` (`@tinker/cli`'s `Cli.Row` has no stderr channel for a
 * code-0 command, only for a thrown error or usage — see the report's deviations). */
function verifyLines(report: Blueprint.VerifyReport, bodySkipped: boolean): string {
  const lines = [
    ...report.findings.map(findingLine),
    `ok: ${report.nodes} nodes, ${report.units} units, ${report.findings.length} findings`,
    ...(bodySkipped ? ["body templates skipped: no key"] : []),
  ];
  return `${lines.join("\n")}\n`;
}

/** Every `*.ts` file under `dir`, recursively, relative to `dir` — never `*.test.ts` or
 * `*.d.ts` (source only; a test or a type-only declaration names no runtime unit). */
function tsFilesUnder(dir: string, base: string = dir): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsFilesUnder(full, base);
    if (
      !entry.name.endsWith(".ts") ||
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".d.ts")
    )
      return [];
    return [relative(base, full)];
  });
}

/** Every declared unit under `dir` — the walk and the parse both happen here, the process
 * edge, not in `verify`'s `run` (ADR 0055 §2). */
function walk(dir: string): readonly Blueprint.Unit[] {
  return tsFilesUnder(dir).flatMap((file) =>
    readUnits(readFileSync(join(dir, file), "utf8"), file),
  );
}

/** Every argv entry that is neither a flag nor `--key-file`'s value, in order — the root
 * reads the key before the row sees argv, so the path must not read as a positional. */
function positionals(argv: readonly string[]): readonly string[] {
  return argv.filter((arg, i) => !arg.startsWith("--") && argv[i - 1] !== "--key-file");
}

/** The two non-flag argv entries `verify` takes: the blueprint file, then the source dir. */
function verifyArgs(argv: readonly string[]): { readonly file: string; readonly dir: string } {
  const [file, dir] = positionals(argv);
  return { file: file ?? "", dir: dir ?? "" };
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

/** One grade as a line: `✓` proven, `~` provisional, `✗` noisy, then the numbers behind it,
 * including how many of the golden design's cases it hit. */
function gradeLine(grade: Blueprint.Grade, idWidth: number): string {
  const mark = grade.status === "proven" ? "✓" : grade.status === "noisy" ? "✗" : "~";
  return (
    `${mark} ${grade.id.padEnd(idWidth)}  ${grade.status.padEnd(11)}` +
    `  bad ${grade.bad.length} (med ${pct(median(grade.bad))})` +
    `  clean ${grade.clean.length} (med ${pct(median(grade.clean))})` +
    `  sep ${pct(grade.sep)}  ordered ${pct(grade.ordered)}` +
    `  golden ${grade.goldenHits.length}/${grade.goldenTotal}`
  );
}

/** One line per template's grade, widest id first so the columns line up. */
function evalsLines(grades: readonly Blueprint.Grade[]): string {
  const idWidth = Math.max(0, ...grades.map((grade) => grade.id.length));
  return `${grades.map((grade) => gradeLine(grade, idWidth)).join("\n")}\n`;
}

/** One choice template by id off the loaded corpus. Throws `NoTemplate` when the
 * corpus does not carry it — an invariant of the shipped corpus, only reachable
 * with `corpusPath` rebound to a folder missing `unitFits` or `target`. */
function choiceTemplateById(
  corpus: Blueprint.Corpus,
  id: string,
): Blueprint.Template & { readonly kind: "choice" } {
  const found = corpus.templates.find((template) => template.id === id);
  if (found === undefined || found.kind !== "choice")
    raise("NoTemplate", { id }, `blueprint: suggest needs the "${id}" template`);
  return found;
}

/** A choice answer's own confidence: its pick's share of `probabilities`, 0 when absent. */
function confidenceOf(answer: Blueprint.Answer): number {
  return answer.type === "choice" ? (answer.probabilities?.[answer.choice] ?? 0) : 0;
}

/** The operation: input `{ words }`, depends `{ corpus, judge }` — asks `unitFits` once;
 * on a confident `resource` pick, asks `target` once more. Returns the two raw answers
 * beside each template's `minConfidence` (`respond` needs it to tell confident from
 * unclear) and, on a confident pick, the shape text for it. */
export const suggest: Operation.Handle<
  Promise<{
    readonly unit: Blueprint.Answer;
    readonly unitMinConfidence: number;
    readonly target?: Blueprint.Answer;
    readonly targetMinConfidence?: number;
    readonly shape?: string;
  }>,
  { readonly words: string }
> = operation({
  label: "suggest",
  input: parseSuggestInput,
  depends: { corpus, judge },
  run: async ({ corpus, judge }, ctx) => {
    const state: Blueprint.WordsState = { description: ctx.input.words };
    const unitFits = choiceTemplateById(corpus, "unitFits");
    const unitAnswers = await judge.ask(
      state,
      { unitFits: templateQuestion(unitFits) },
      ctx.signal,
    );
    const unit = unitAnswers.unitFits;
    const confident = confidenceOf(unit) >= unitFits.minConfidence;
    const shape = confident && unit.type === "choice" ? unitFits.shapes?.[unit.choice] : undefined;
    if (!confident || unit.type !== "choice" || unit.choice !== "resource")
      return { unit, unitMinConfidence: unitFits.minConfidence, shape };
    const target = choiceTemplateById(corpus, "target");
    const targetAnswers = await judge.ask(state, { target: templateQuestion(target) }, ctx.signal);
    return {
      unit,
      unitMinConfidence: unitFits.minConfidence,
      target: targetAnswers.target,
      targetMinConfidence: target.minConfidence,
      shape,
    };
  },
});

/** Every column starts at this width: `"unit:".padEnd(9)` reads `"unit:    "`. */
const LABEL_WIDTH = 9;

function labeled(label: string, value: string): string {
  return `${`${label}:`.padEnd(LABEL_WIDTH)}${value}`;
}

/** The picked choice's probabilities, widest share first: `resource 78%, operation 15%`. */
function distribution(answer: Blueprint.Answer): string {
  if (answer.type !== "choice") return "";
  return Object.entries(answer.probabilities ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([choice, p]) => `${choice} ${pct(p)}`)
    .join(", ");
}

/** `resource (78%)` at or above `minConfidence`, else `unclear (resource only 55%) —
 * decide with the one law`. */
function unitPickText(answer: Blueprint.Answer, minConfidence: number): string {
  if (answer.type !== "choice") return "";
  const confidence = confidenceOf(answer);
  return confidence >= minConfidence
    ? `${answer.choice} (${pct(confidence)})`
    : `unclear (${answer.choice} only ${pct(confidence)}) — decide with the one law`;
}

/** `scope (81%)` at or above `minConfidence`, else `unclear (session only 52%)`. */
function targetPickText(answer: Blueprint.Answer, minConfidence: number): string {
  if (answer.type !== "choice") return "";
  const confidence = confidenceOf(answer);
  return confidence >= minConfidence
    ? `${answer.choice} (${pct(confidence)})`
    : `unclear (${answer.choice} only ${pct(confidence)})`;
}

/** `unit:`/`shape:`/`target:`/`all:`, one per line — `shape:` and `target:` only when
 * `suggest` returned them. */
function suggestLines(result: {
  readonly unit: Blueprint.Answer;
  readonly unitMinConfidence: number;
  readonly target?: Blueprint.Answer;
  readonly targetMinConfidence?: number;
  readonly shape?: string;
}): string {
  const lines = [labeled("unit", unitPickText(result.unit, result.unitMinConfidence))];
  if (result.shape !== undefined) lines.push(labeled("shape", result.shape));
  if (result.target !== undefined && result.targetMinConfidence !== undefined)
    lines.push(labeled("target", targetPickText(result.target, result.targetMinConfidence)));
  lines.push(labeled("all", distribution(result.unit)));
  return `${lines.join("\n")}\n`;
}

/** The first argv entry that is not a flag and is not `--key-file`'s value. */
function fileArg(argv: readonly string[]): string | undefined {
  return positionals(argv)[0];
}

/** The binary: every command runs on the same root options, so the entrypoint binds the key once
 * and a test binds its fakes the same way. `input` reads the named file off disk (the process
 * edge, at the root) beside the `--json` flag; `respond` prints the lines or,
 * with `--json`, the report as one JSON object. */
export function shell(options: Scope.Options = {}): Process.Shell {
  return {
    name: "blueprint",
    version: "0.0.0",
    commands: [
      command("check", () => check, {
        description: "judge one blueprint file with Jev over the shipped question templates",
        input: (argv) => ({
          text: readFileSync(fileArg(argv) ?? "", "utf8"),
          json: argv.includes("--json"),
        }),
        respond: ({ json, report }) => (json ? `${JSON.stringify(report)}\n` : checkLines(report)),
        options,
      }),
      command("explain", () => explain, {
        description: "print every template verbatim, or as a markdown list with --md",
        input: (argv) => ({ md: argv.includes("--md") }),
        respond: (report) =>
          report.md
            ? `${report.templates.map(markdown).join("\n\n")}\n`
            : `${report.templates.map(verbatim).join("\n\n")}\n`,
        options,
      }),
      command("evals", () => evals, {
        description: "grade every template against its evals with the judge (needs a key)",
        respond: evalsLines,
        options,
      }),
      command("suggest", () => suggest, {
        description: "which unit fits a sentence, with the shape to write (needs a key)",
        input: (argv) => ({ words: argv.join(" ") }),
        respond: suggestLines,
        options,
      }),
      command("verify", () => verify, {
        description:
          "diff a blueprint file's nodes against the code's declared units, plus body templates with a key",
        input: (argv) => {
          const { file, dir } = verifyArgs(argv);
          return {
            text: readFileSync(file, "utf8"),
            units: walk(dir),
            dir,
            json: argv.includes("--json"),
          };
        },
        respond: ({ json, report, bodySkipped }) =>
          json ? `${JSON.stringify(report)}\n` : verifyLines(report, bodySkipped),
        options,
      }),
    ],
  };
}
