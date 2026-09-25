// Reproducible canary proofs for the kitchen queue checker.
// Builds every proof tar from the teacher-only fixture, runs the isolated
// runner in Docker, and prints one line per proof. No worker code involved.
// Usage: node tools/writer-trial/teacher/kitchen-canaries.mjs
// Proof tars land in an owned /tmp/kitchen-canaries-<unique> dir and are
// rebuilt on every run; only the printed case lines and exit codes are
// the evidence.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
// tinker-writer-trial:20260925, built 2026-09-25 from the current core and
// react builds (context: ~/.local/share/tinker-writer-trial/image-20260925).
// Earlier pins: sha256:91630289… (20260922 rebuilt 2026-09-24) and
// sha256:2232d27e… (20260922, no longer on this host).
// WRITER_TRIAL_IMAGE reruns these proofs on a rebuilt image (the pinned one can be lost
// when the host is rebuilt); the pinned ID stays the default and the recorded evidence.
const IMAGE =
  process.env.WRITER_TRIAL_IMAGE ??
  "sha256:ac6b1e42b3f428180c6f5109a76b238a2da5a1f4874d3750b8c1088ba36e9881";
const TOOLCHAIN = "/home/pwuser/toolchain/node_modules";
const work = join(tmpdir(), `kitchen-canaries-${randomUUID()}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const pack = (dir, tar) => {
  execFileSync("tar", ["-cf", tar, "."], { cwd: dir });
  return tar;
};

// The submission layout the grading container gets at /work: src/,
// index.html, and the toolchain symlink.
const fixture = join(here, "kitchen-fixture");
const base = join(work, "good");
mkdirSync(base, { recursive: true });
cpSync(join(fixture, "src"), join(base, "src"), { recursive: true });
cpSync(join(fixture, "index.html"), join(base, "index.html"));
execFileSync("ln", ["-s", TOOLCHAIN, join(base, "node_modules")]);

// One edit to one fixture file. Each anchor must match exactly once, so a
// moved fixture line fails loudly instead of proving nothing.
const edit = (text, [from, to], label) => {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: anchor found ${count} times; update the script`);
  return text.replace(from, to);
};
const patch = (name, file, swaps) => {
  const dir = join(work, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(base, dir, { recursive: true, verbatimSymlinks: true });
  const path = join(dir, "src", file);
  let text = readFileSync(path, "utf8");
  for (const swap of swaps) text = edit(text, swap, name);
  writeFileSync(path, text);
  return pack(dir, join(work, `${name}.tar`));
};

const run = (tar) => {
  const script = join(repo, "tools/writer-trial/kitchen-acceptance.mjs");
  let out = "";
  let exit = 0;
  try {
    out = execFileSync("node", [script, tar, IMAGE], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 330000,
    });
  } catch (error) {
    out = `${error.stdout ?? ""}`;
    exit = error.status ?? 1;
  }
  const lines = out.split("\n");
  return {
    exit,
    line: lines.find((l) => l.startsWith("ACCEPTANCE")),
    json: lines.find((l) => l.startsWith("RESULTS_JSON")) ?? "",
    fails: lines.filter((l) => l.startsWith("FAIL")),
  };
};

// Strict proof: exit code alone cannot pass. A canary passes only with
// structured RESULTS_JSON, no load failure unless allowed, and the exact
// intended failures named below.
const casesOf = (r) => {
  const raw = r.json.replace(/^RESULTS_JSON\s*/, "");
  if (raw === "") throw new Error("missing RESULTS_JSON");
  return JSON.parse(raw).cases;
};
const failedNames = (r) =>
  casesOf(r)
    .filter((c) => !c.pass)
    .map((c) => c.name);
const loadFailed = (r) =>
  casesOf(r)
    .filter((c) => !c.pass && (c.error ?? "").includes("load failed"))
    .map((c) => c.name);
const checkNames = (r, want) => {
  if (want.allowLoadFail !== true && loadFailed(r).length > 0)
    return `load failure, not a behavioral proof: ${loadFailed(r).join(", ")}`;
  const failed = new Set(failedNames(r));
  const missing = (want.mustFail ?? []).filter((n) => !failed.has(n));
  if (missing.length > 0) return `want failure ${missing.join(", ")}`;
  const wrong = (want.mustPass ?? []).filter((n) => failed.has(n));
  if (wrong.length > 0) return `want pass ${wrong.join(", ")}, but it failed`;
  return null;
};
const checkResult = (r, want) => {
  if (r.exit !== want.exit) return `want exit ${want.exit}, got ${r.exit}`;
  if (want.fullpass !== undefined && r.line !== want.fullpass)
    return `want ${want.fullpass}, got ${r.line ?? "(no summary)"}`;
  return checkNames(r, want);
};

// ---- good layouts: the same app in every kit layout ----
// The kit (src/layout.tsx) names its layouts in LAYOUTS. Each one packs the
// fixture with src/layout-choice.ts pointing at it, and every layout must
// pass every case: the task names fields, tables, buttons, and the alert,
// not where they sit or how they are labeled. Bad variants below run on
// the baseline layout.
const kitText = readFileSync(join(fixture, "src", "layout.tsx"), "utf8");
const layoutBlock = /export const LAYOUTS[^=]*= \{\n([\s\S]*?)\n\};/.exec(kitText);
if (layoutBlock === null) throw new Error("LAYOUTS not found in layout.tsx; update the script");
const LAYOUT_NAMES = [...layoutBlock[1].matchAll(/^ {2}(\w+): \{$/gm)].map((m) => m[1]);
if (LAYOUT_NAMES.length < 5 || !LAYOUT_NAMES.includes("baseline"))
  throw new Error(`found layouts ${LAYOUT_NAMES.join(", ")}; update the script`);
const layoutTar = (name) => {
  const dir = join(work, `layout-${name}`);
  rmSync(dir, { recursive: true, force: true });
  cpSync(base, dir, { recursive: true, verbatimSymlinks: true });
  writeFileSync(
    join(dir, "src", "layout-choice.ts"),
    `export const LAYOUT_NAME: string = "${name}";\n`,
  );
  return pack(dir, join(work, `layout-${name}.tar`));
};

// ---- bad variants: each must fail its named case ----
// (a) Blank qty text becomes 1 instead of BadQty.
const blankQtyTar = patch("bad-blank-qty", "model.ts", [
  [
    "function readQty(raw: unknown): number {\n",
    'function readQty(raw: unknown): number {\n  if (typeof raw === "string" && raw.trim() === "") return 1;\n',
  ],
]);

// The already-cooking check and the guards after it in startCooking, in
// the fixture's order.
const ALREADY_COOKING = '    if (ticket.state === "cooking") return ticket;\n';
const START_GUARDS = [
  '    if (ticket.state === "served") throw fail("AlreadyServed", { id: ticket.id });\n',
  "    const size = cells.stove.get();\n",
  '    if (cookingCount(rows) >= size) throw fail("StoveFull", { size });\n',
].join("");

// (b) The stove-full guard runs before the already-cooking check, so
// starting a cooking ticket on a full stove reports StoveFull.
const cookingFullTar = patch("bad-cooking-on-full-stove", "model.ts", [
  [ALREADY_COOKING + START_GUARDS, START_GUARDS + ALREADY_COOKING],
]);

const ALREADY_SERVED = '    if (ticket.state === "served") return ticket;\n';
const NOT_COOKING =
  '    if (ticket.state === "waiting") throw fail("NotCooking", { id: ticket.id });\n';

// (c1) No already-served check: serving a served ticket writes it again
// and adds an undo step.
const serveTwiceStepTar = patch("bad-serve-twice-step", "model.ts", [
  [ALREADY_SERVED + NOT_COOKING, NOT_COOKING],
]);

// (c2) Serving a served ticket reports NotCooking.
const serveTwiceErrorTar = patch("bad-serve-twice-error", "model.ts", [
  [
    ALREADY_SERVED + NOT_COOKING,
    '    if (ticket.state !== "cooking") throw fail("NotCooking", { id: ticket.id });\n',
  ],
]);

// (d) A second order for a waiting table and dish appends a new ticket.
const appendTar = patch("bad-merge-appends", "model.ts", [
  ["      if (open !== undefined) {\n", '      if (open !== undefined && open.id === "") {\n'],
]);

// (e) The Waiting filter also shows cooking tickets.
const waitingShowsCookingTar = patch("bad-waiting-shows-cooking", "screen.ts", [
  [
    '  filter === "All" || filter === state;\n',
    '  filter === "All" || filter === state || (filter === "Waiting" && state === "Cooking");\n',
  ],
]);

const UNDO_ANCHOR =
  "  depends: { shown: notice.controller, undo: undoKitchen.controller },\n  run: ({ shown, undo }) => {\n";

// (f1) Undo also puts the filter back to All.
const undoFilterTar = patch("bad-undo-resets-filter", "screen.ts", [
  [
    UNDO_ANCHOR,
    '  depends: { shown: notice.controller, undo: undoKitchen.controller, filter: ticketFilter.controller },\n  run: ({ shown, undo, filter }) => {\n    filter.set("All");\n',
  ],
]);

// (f2) Undo also clears the typed new-ticket text.
const undoTextTar = patch("bad-undo-clears-text", "screen.ts", [
  [
    UNDO_ANCHOR,
    "  depends: { shown: notice.controller, undo: undoKitchen.controller, draft: ticketDraft.controller },\n  run: ({ shown, undo, draft }) => {\n    draft.set(emptyTicket);\n",
  ],
]);

// (g1) An empty starter: nothing at all under /work.
const emptyDir = join(work, "empty");
mkdirSync(emptyDir, { recursive: true });
const emptyTar = pack(emptyDir, join(work, "empty.tar"));

// (g2) A blank Vite starter: it boots and exports nothing.
const starterDir = join(work, "starter");
mkdirSync(join(starterDir, "src"), { recursive: true });
cpSync(join(fixture, "index.html"), join(starterDir, "index.html"));
writeFileSync(join(starterDir, "src", "index.ts"), "export {};\n");
writeFileSync(
  join(starterDir, "src", "main.tsx"),
  'const root = document.getElementById("root");\nif (root !== null) root.textContent = "Hello";\n',
);
execFileSync("ln", ["-s", TOOLCHAIN, join(starterDir, "node_modules")]);
const starterTar = pack(starterDir, join(work, "starter.tar"));

const UNDO_CASE =
  "browser undo restores records and the stove and keeps form text, dish, and filter";
const SERVE_NOOP = "core serving a served ticket passes with no change or undo step";
const FULL = "ACCEPTANCE kitchen: 53/53 pass";
const cases = [
  ...LAYOUT_NAMES.map((name) => ({
    label: `layout ${name} accepts`,
    tar: layoutTar(name),
    want: { exit: 0, fullpass: FULL },
  })),
  {
    label: "(a) blank qty becomes 1 rejects",
    tar: blankQtyTar,
    want: {
      exit: 1,
      mustFail: ["core bad qty text reports BadQty with the original value"],
      mustPass: ["core add trims, parses, and appends waiting tickets in creation order"],
    },
  },
  {
    label: "(b) starting a cooking ticket on a full stove reports StoveFull rejects",
    tar: cookingFullTar,
    want: {
      exit: 1,
      mustFail: ["core starting a cooking ticket passes even when the stove is full"],
      mustPass: [
        "core starting a cooking ticket passes with no change or undo step",
        "core a waiting ticket on a full stove reports StoveFull with the size",
      ],
    },
  },
  {
    label: "(c1) serving a served ticket adds an undo step rejects",
    tar: serveTwiceStepTar,
    want: {
      exit: 1,
      mustFail: [SERVE_NOOP],
      mustPass: ["core serveTicket moves a cooking ticket to served with one undo step"],
    },
  },
  {
    label: "(c2) serving a served ticket reports an error rejects",
    tar: serveTwiceErrorTar,
    want: {
      exit: 1,
      mustFail: [SERVE_NOOP],
      mustPass: ["core serving a waiting ticket reports NotCooking"],
    },
  },
  {
    label: "(d) a repeat order appends instead of growing the waiting ticket rejects",
    tar: appendTar,
    want: {
      exit: 1,
      mustFail: ["core adding the same table and dish grows the waiting ticket in place"],
      mustPass: ["core add trims, parses, and appends waiting tickets in creation order"],
    },
  },
  {
    label: "(e) Waiting filter also shows cooking tickets rejects",
    tar: waitingShowsCookingTar,
    want: {
      exit: 1,
      mustFail: ["browser filters show only rows in that state and update live"],
      mustPass: ["browser typing clears an earlier alert"],
    },
  },
  {
    label: "(f1) undo resets the filter rejects",
    tar: undoFilterTar,
    want: { exit: 1, mustFail: [UNDO_CASE] },
  },
  {
    label: "(f2) undo clears the form text rejects",
    tar: undoTextTar,
    want: { exit: 1, mustFail: [UNDO_CASE] },
  },
  {
    label: "(g1) empty starter rejects",
    tar: emptyTar,
    want: { exit: 1, allowLoadFail: true, mustFail: ["shape: src present"] },
  },
  {
    label: "(g2) blank app starter rejects",
    tar: starterTar,
    want: {
      exit: 1,
      allowLoadFail: true,
      mustFail: ["core entry exports exactly the named API"],
    },
  },
];

// `--only <label prefix>` runs a subset while tuning; a full run is the proof.
const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : "";
let failed = 0;
for (const { label, tar, want } of cases.filter((c) => c.label.startsWith(only))) {
  const r = run(tar);
  const problem = checkResult(r, want);
  if (problem !== null) failed++;
  const caughtBy = want.mustFail ? ` — caught by: ${want.mustFail.join("; ")}` : "";
  console.log(
    `${problem === null ? "CANARY-PASS" : "CANARY-FAIL"} ${label} — exit ${r.exit} — ${r.line ?? "(no summary)"}${problem === null ? caughtBy : ` — ${problem}`}`,
  );
  for (const f of r.fails.slice(0, 4)) console.log(`    ${f}`);
  if (r.fails.length > 4) console.log(`    ... ${r.fails.length - 4} more FAIL lines`);
}
process.exitCode = failed ? 1 : 0;
