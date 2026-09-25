// Reproducible canary proofs for the cinema seat map checker.
// Builds every proof tar from the teacher-only fixture, runs the isolated
// runner in Docker, and prints one line per proof. No worker code involved.
// Usage: node tools/writer-trial/teacher/cinema-canaries.mjs
// Proof tars land in an owned /tmp/cinema-canaries-<unique> dir and are
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
const work = join(tmpdir(), `cinema-canaries-${randomUUID()}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const pack = (dir, tar) => {
  execFileSync("tar", ["-cf", tar, "."], { cwd: dir });
  return tar;
};

// The submission layout the grading container gets at /work: src/,
// index.html, and the toolchain symlink.
const fixture = join(here, "cinema-fixture");
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
  const script = join(repo, "tools/writer-trial/cinema-acceptance.mjs");
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

// ---- good layouts: the fixture once per kit layout (layout-kit/README.md) ----
// Every name in the kit's LAYOUTS, read from the fixture's own copy, packs
// the same app with src/layout-choice.ts overwritten to that name.
const kitText = readFileSync(join(fixture, "src", "layout.tsx"), "utf8");
const layoutBlock = kitText.slice(kitText.indexOf("export const LAYOUTS"));
const LAYOUT_NAMES = [
  ...layoutBlock.slice(0, layoutBlock.indexOf("\n};")).matchAll(/^ {2}(\w+): \{$/gm),
].map((m) => m[1]);
if (LAYOUT_NAMES.length < 5)
  throw new Error(`found layouts ${LAYOUT_NAMES.join(", ")}; update the script`);
const layoutTar = (name) => {
  const dir = join(work, `layout-${name}`);
  rmSync(dir, { recursive: true, force: true });
  cpSync(base, dir, { recursive: true, verbatimSymlinks: true });
  writeFileSync(
    join(dir, "src", "layout-choice.ts"),
    `export const LAYOUT_NAME: string = ${JSON.stringify(name)};\n`,
  );
  return pack(dir, join(work, `layout-${name}.tar`));
};

// ---- bad variants: each must fail its named case ----
// (a) Blank number text becomes number 1 instead of BadNumber.
const blankNumberTar = patch("bad-blank-number", "model.ts", [
  [
    "function readNumber(raw: unknown): number {\n",
    'function readNumber(raw: unknown): number {\n  if (typeof raw === "string" && raw.trim() === "") return 1;\n',
  ],
]);

// The same-customer check and the SeatLimit guard after it in holdSeat,
// in the fixture's order.
const SAME_CUSTOMER =
  '      if (seat.state === "held" && seat.customer === customer) return seat;\n';
const LIMIT_GUARD = [
  "      if (rows.filter((each) => each.customer === customer).length >= SEAT_LIMIT)\n",
  '        throw fail("SeatLimit", { customer });\n',
].join("");

// (b) The SeatLimit guard runs before the same-customer check, so a
// repeat hold at the limit reports SeatLimit.
const limitFirstTar = patch("bad-repeat-at-limit", "model.ts", [
  [SAME_CUSTOMER + LIMIT_GUARD, LIMIT_GUARD + SAME_CUSTOMER],
]);

const ALREADY_FREE = '    if (seat.state === "free") return seat;\n';
const SOLD_GUARD = '    if (seat.state === "sold") throw fail("SeatSold", { id: seat.id });\n';

// (c1) No already-free check: releasing a free seat writes it again and
// adds an undo step.
const releaseTwiceStepTar = patch("bad-release-twice-step", "model.ts", [
  [ALREADY_FREE + SOLD_GUARD, SOLD_GUARD],
]);

// (c2) Releasing a free seat reports SeatSold.
const releaseTwiceErrorTar = patch("bad-release-twice-error", "model.ts", [
  [
    ALREADY_FREE + SOLD_GUARD,
    '    if (seat.state !== "held") throw fail("SeatSold", { id: seat.id });\n',
  ],
]);

// (d) Buy sells seat by seat, one undo step per seat.
const buyStepsTar = patch("bad-buy-step-per-seat", "model.ts", [
  [
    [
      "    const step = cells.seats.get();",
      "    cells.history.update((steps) => [...steps, step]);",
      "    cells.seats.set(sold.reduce(replaceSeat, rows));",
      "",
    ].join("\n"),
    [
      "    for (const seat of sold) {",
      "      const step = cells.seats.get();",
      "      cells.history.update((steps) => [...steps, step]);",
      "      cells.seats.update((now) => replaceSeat(now, seat));",
      "    }",
      "",
    ].join("\n"),
  ],
]);

const RELEASE_HEAD = [
  '  label: "releaseSeat",',
  "  depends: mapCells,",
  "  run: (cells, { rawInput }) => {",
  "    const rows = cells.seats.get();",
  '    const seat = findSeat(rows, fieldOf(rawInput, "seatId"));',
].join("\n");

// (e1) releaseSeat gets an input reader and trusts ctx.input: a
// `{ rawInput }` call is read to text, but a `{ input }` call skips the
// reader, so a non-text id reaches NotFound as it came (a number).
const inputPayloadTar = patch("bad-input-id-not-text", "model.ts", [
  [
    RELEASE_HEAD,
    [
      '  label: "releaseSeat",',
      "  depends: mapCells,",
      "  input: (raw: unknown) => {",
      '    const id = fieldOf(raw, "seatId");',
      '    return { seatId: typeof id === "string" ? id : "" };',
      "  },",
      "  run: (cells, { input }) => {",
      "    const rows = cells.seats.get();",
      "    const seat = rows.find((row) => row.id === input.seatId);",
      '    if (seat === undefined) throw fail("NotFound", { id: input.seatId });',
    ].join("\n"),
  ],
]);

// (e2) releaseSeat reads ctx.input with no reader: a `{ rawInput }` call
// leaves ctx.input undefined and the body throws a TypeError.
const rawInputCrashTar = patch("bad-raw-input-crash", "model.ts", [
  [
    RELEASE_HEAD,
    [
      '  label: "releaseSeat",',
      "  depends: mapCells,",
      "  run: (cells, { input }) => {",
      "    const rows = cells.seats.get();",
      "    const seat = findSeat(rows, input.seatId);",
    ].join("\n"),
  ],
]);

// (f) The Held filter also shows sold seats.
const heldShowsSoldTar = patch("bad-held-shows-sold", "screen.ts", [
  [
    '  filter === "All" || filter === state;\n',
    '  filter === "All" || filter === state || (filter === "Held" && state === "Sold");\n',
  ],
]);

const UNDO_ANCHOR =
  "  depends: { shown: notice.controller, undo: undoSeats.controller },\n  run: ({ shown, undo }) => {\n";

// (g1) Undo also puts the filter back to All.
const undoFilterTar = patch("bad-undo-resets-filter", "screen.ts", [
  [
    UNDO_ANCHOR,
    '  depends: { shown: notice.controller, undo: undoSeats.controller, filter: seatFilter.controller },\n  run: ({ shown, undo, filter }) => {\n    filter.set("All");\n',
  ],
]);

// (g2) Undo also clears the typed form text.
const undoTextTar = patch("bad-undo-clears-text", "screen.ts", [
  [
    UNDO_ANCHOR,
    "  depends: { shown: notice.controller, undo: undoSeats.controller, draft: seatDraft.controller },\n  run: ({ shown, undo, draft }) => {\n    draft.set(emptyDraft);\n",
  ],
]);

// (h1) An empty starter: nothing at all under /work.
const emptyDir = join(work, "empty");
mkdirSync(emptyDir, { recursive: true });
const emptyTar = pack(emptyDir, join(work, "empty.tar"));

// (h2) A blank Vite starter: it boots and exports nothing.
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

const UNDO_CASE = "browser undo restores seats and keeps form text and the filter";
const RELEASE_NOOP = "core releasing a free seat passes with no change or undo step";
const INPUT_ID = "core a non-text seatId passed as { input } reports NotFound with a text id";
const RAW_ID = "core a non-text seatId passed as { rawInput } reports NotFound with a text id";
const FULL = "ACCEPTANCE cinema: 41/41 pass";
const cases = [
  ...LAYOUT_NAMES.map((name) => ({
    label: `good layout ${name} accepts`,
    tar: layoutTar(name),
    want: { exit: 0, fullpass: FULL },
  })),
  {
    label: "(a) blank number becomes 1 rejects",
    tar: blankNumberTar,
    want: {
      exit: 1,
      mustFail: ["core bad number text reports BadNumber with the original value"],
      mustPass: [
        "core holdSeat trims and holds a free seat for the trimmed customer with one undo step",
      ],
    },
  },
  {
    label: "(b) a same-customer repeat hold at the limit reports SeatLimit rejects",
    tar: limitFirstTar,
    want: {
      exit: 1,
      mustFail: [
        "core a same-customer repeat hold at the limit passes with no change or undo step",
      ],
      mustPass: [
        "core holding a seat the same customer holds passes with no change or undo step",
        "core SeatLimit counts held plus sold seats and reports the trimmed customer",
      ],
    },
  },
  {
    label: "(c1) releasing a free seat adds an undo step rejects",
    tar: releaseTwiceStepTar,
    want: {
      exit: 1,
      mustFail: [RELEASE_NOOP],
      mustPass: ["core releaseSeat frees a held seat with no customer and one undo step"],
    },
  },
  {
    label: "(c2) releasing a free seat reports an error rejects",
    tar: releaseTwiceErrorTar,
    want: {
      exit: 1,
      mustFail: [RELEASE_NOOP],
      mustPass: ["core releasing a sold seat reports SeatSold"],
    },
  },
  {
    label: "(d) buy adds one undo step per seat rejects",
    tar: buyStepsTar,
    want: {
      exit: 1,
      mustFail: [
        "core buySeats sells every seat the customer holds in seat order as one undo step",
      ],
      mustPass: ["core buying with no held seat reports NothingHeld with the trimmed customer"],
    },
  },
  {
    label: "(e1) a non-text seatId passed as { input } reaches NotFound as a number rejects",
    tar: inputPayloadTar,
    want: { exit: 1, mustFail: [INPUT_ID], mustPass: [RAW_ID] },
  },
  {
    label: "(e2) a { rawInput } call on a body with no reader crashes rejects",
    tar: rawInputCrashTar,
    want: { exit: 1, mustFail: [RAW_ID], mustPass: [INPUT_ID] },
  },
  {
    label: "(f) Held filter also shows sold seats rejects",
    tar: heldShowsSoldTar,
    want: {
      exit: 1,
      mustFail: ["browser filters show only seats in that state and update live"],
      mustPass: ["browser typing clears an earlier alert"],
    },
  },
  {
    label: "(g1) undo resets the filter rejects",
    tar: undoFilterTar,
    want: { exit: 1, mustFail: [UNDO_CASE] },
  },
  {
    label: "(g2) undo clears the form text rejects",
    tar: undoTextTar,
    want: { exit: 1, mustFail: [UNDO_CASE] },
  },
  {
    label: "(h1) empty starter rejects",
    tar: emptyTar,
    want: { exit: 1, allowLoadFail: true, mustFail: ["shape: src present"] },
  },
  {
    label: "(h2) blank app starter rejects",
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
