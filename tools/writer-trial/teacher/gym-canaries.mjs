// Reproducible canary proofs for the gym class waitlist checker.
// Builds every proof tar from the teacher-only fixture, runs the isolated
// runner in Docker, and prints one line per proof. No worker code involved.
// Usage: node tools/writer-trial/teacher/gym-canaries.mjs
// Proof tars land in an owned /tmp/gym-canaries-<unique> dir and are
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
// tinker-writer-trial:20260925.1: the 20260925 core and react builds (2026-09-25) plus
// Vite cache links to /tmp (context: ~/.local/share/tinker-writer-trial/image-20260925.1).
// Earlier pins: sha256:91630289… (20260922 rebuilt 2026-09-24) and
// sha256:2232d27e… (20260922, no longer on this host).
// WRITER_TRIAL_IMAGE reruns these proofs on a rebuilt image (the pinned one can be lost
// when the host is rebuilt); the pinned ID stays the default and the recorded evidence.
const IMAGE =
  process.env.WRITER_TRIAL_IMAGE ??
  "sha256:c450fe6d501e8ecd295547e86901d177e944f6d66fd71ea84fcb4eaeed55e745";
const TOOLCHAIN = "/home/pwuser/toolchain/node_modules";
const work = join(tmpdir(), `gym-canaries-${randomUUID()}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const pack = (dir, tar) => {
  execFileSync("tar", ["-cf", tar, "."], { cwd: dir });
  return tar;
};

// The submission layout the grading container gets at /work: src/,
// index.html, and the toolchain symlink.
const fixture = join(here, "gym-fixture");
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
  const script = join(repo, "tools/writer-trial/gym-acceptance.mjs");
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

// ---- bad variants: each must fail its named case, on the baseline layout ----
const READ_CAPACITY = "function readCapacity(raw: unknown): number {\n";

// (a1) Blank capacity text becomes 1 instead of BadCapacity.
const blankCapacityTar = patch("bad-blank-capacity", "model.ts", [
  [
    READ_CAPACITY,
    `${READ_CAPACITY}  if (typeof raw === "string" && raw.trim() === "") return 1;\n`,
  ],
]);

// (a2) A leading zero is read past: "05" becomes 5 instead of BadCapacity.
const leadingZeroTar = patch("bad-leading-zero", "model.ts", [
  ["const CAPACITY = /^(?:[1-9]|1\\d|20)$/;", "const CAPACITY = /^0*(?:[1-9]|1\\d|20)$/;"],
]);

const LEAVE_WRITE =
  '    cells.signups.set(saved.status === "booked" ? bookWaiters(rest, found.id, 1) : rest);\n';

// (b) Promotion books the last waiting member, not the first.
const lastWaiterTar = patch("bad-last-waiter", "model.ts", [
  [
    LEAVE_WRITE,
    '    cells.signups.set(saved.status === "booked" ? [...bookWaiters([...rest].reverse(), found.id, 1)].reverse() : rest);\n',
  ],
]);

// (c) The promoted signup moves to the end of signups.
const promotedMovesTar = patch("bad-promoted-moves", "model.ts", [
  [
    LEAVE_WRITE,
    [
      '    const first = rest.find((each) => each.classId === found.id && each.status === "waiting");',
      '    cells.signups.set(saved.status === "booked" && first !== undefined ? [...rest.filter((each) => each !== first), { ...first, status: "booked" }] : rest);',
      "",
    ].join("\n"),
  ],
]);

// (d) Raising the capacity books no waiting member.
const raiseBooksNoneTar = patch("bad-raise-books-none", "model.ts", [
  ["      cells.signups.set(bookWaiters(list, found.id, capacity - booked));\n", ""],
]);

const SAME_SIGNUP = "    if (saved !== undefined) return saved;\n";

// (e) A no-op join adds an undo step.
const noOpStepTar = patch("bad-no-op-join-step", "model.ts", [
  [
    SAME_SIGNUP,
    "    if (saved !== undefined) {\n      cells.history.update((steps) => [...steps, { classes: rows, signups: list }]);\n      return saved;\n    }\n",
  ],
]);

// (e2) A repeat-member guard runs before the already-joined check, so a
// no-op join is refused with an error (the gate proof's plant).
const FIND_SAME = "    const saved = findSignup(list, found.id, member);\n";
const noOpErrorTar = patch("bad-no-op-join-error", "model.ts", [
  [
    FIND_SAME + SAME_SIGNUP,
    `    if (list.some((each) => each.classId === found.id && each.member === member))\n      throw fail("DuplicateName", { name: member });\n${FIND_SAME}${SAME_SIGNUP}`,
  ],
]);

// (f) A failed leave pushes its undo step before it finds NotJoined.
const NOT_JOINED =
  '    if (saved === undefined) throw fail("NotJoined", { classId: found.id, member });\n';
const LEAVE_STEP = [
  "    const rest = list.filter((each) => each !== saved);",
  "    const step: Records = { classes: rows, signups: list };",
  "    cells.history.update((steps) => [...steps, step]);",
  "",
].join("\n");
const leaveStepFirstTar = patch("bad-leave-step-first", "model.ts", [
  [
    NOT_JOINED + LEAVE_STEP,
    [
      "    const step: Records = { classes: rows, signups: list };",
      "    cells.history.update((steps) => [...steps, step]);",
      NOT_JOINED.trimEnd(),
      "    const rest = list.filter((each) => each !== saved);",
      "",
    ].join("\n"),
  ],
]);

// (f2) setCapacity writes the new capacity before it finds CapacityTooLow.
const TOO_LOW =
  '      if (capacity < booked) throw fail("CapacityTooLow", { classId: found.id, booked });\n';
const CHANGED = "      const changed: GymClass = { ...found, capacity };\n";
const SET_STEP = [
  "      const step: Records = { classes: rows, signups: list };",
  "      cells.history.update((steps) => [...steps, step]);",
  "      cells.classes.set(rows.map((row) => (row.id === found.id ? changed : row)));",
  "",
].join("\n");
const setBeforeCheckTar = patch("bad-set-before-check", "model.ts", [
  [
    TOO_LOW + CHANGED + SET_STEP,
    [
      CHANGED.trimEnd(),
      "      cells.classes.set(rows.map((row) => (row.id === found.id ? changed : row)));",
      TOO_LOW.trimEnd(),
      "      const step: Records = { classes: rows, signups: list };",
      "      cells.history.update((steps) => [...steps, step]);",
      "",
    ].join("\n"),
  ],
]);

const UNDO_ANCHOR =
  "  depends: { shown: notice.controller, undo: undoGym.controller },\n  run: ({ shown, undo }) => {\n";

// (g1) Undo also puts the filter back to All.
const undoFilterTar = patch("bad-undo-resets-filter", "screen.ts", [
  [
    UNDO_ANCHOR,
    '  depends: { shown: notice.controller, undo: undoGym.controller, filter: signupFilter.controller },\n  run: ({ shown, undo, filter }) => {\n    filter.set("All");\n',
  ],
]);

// (g2) Undo also clears the Member text.
const undoMemberTar = patch("bad-undo-clears-member", "screen.ts", [
  [
    UNDO_ANCHOR,
    '  depends: { shown: notice.controller, undo: undoGym.controller, draft: gymDraft.controller },\n  run: ({ shown, undo, draft }) => {\n    draft.update((text) => ({ ...text, member: "" }));\n',
  ],
]);

// (g3) Undo also forgets the chosen class, so Class shows the first one.
const undoChoiceTar = patch("bad-undo-resets-class", "screen.ts", [
  [
    UNDO_ANCHOR,
    '  depends: { shown: notice.controller, undo: undoGym.controller, chosen: chosenClass.controller },\n  run: ({ shown, undo, chosen }) => {\n    chosen.set("");\n',
  ],
]);

// (h) Typing in Member keeps an earlier alert.
const typingKeepsAlertTar = patch("bad-typing-keeps-alert", "screen.ts", [
  [
    "    draft.update((text) => ({ ...text, member: input.value }));\n    shown.set(undefined);\n",
    "    draft.update((text) => ({ ...text, member: input.value }));\n",
  ],
]);

// (i) Wrapped labels replaced by one fixed id per field name: a second
// root's labels point at the first root's fields.
const fixedIdTar = patch("bad-fixed-label-id", "layout.tsx", [
  [
    "  return (\n    <label>\n      {name}\n      {control}\n    </label>\n  );\n",
    "  return (\n    <span>\n      <label htmlFor={`gym-${name}`}>{name}</label>\n      {cloneElement(control, { id: `gym-${name}` })}\n    </span>\n  );\n",
  ],
]);

// (l) Status shows Waiting with no place in the queue.
const waitingNoPlaceTar = patch("bad-waiting-no-place", "screen.ts", [
  [
    '  return `Waiting ${countOf(list.slice(0, at + 1), signup.classId, "waiting")}`;\n',
    '  return "Waiting";\n',
  ],
]);

// (m) Join sends the stale chosen id after that class is gone.
const staleClassTar = patch("bad-stale-class-id", "screen.ts", [
  [
    "    const classId = shownClassId(saved.get(), chosen.get());\n    try {\n      join.run(",
    '    const classId = chosen.get() || (saved.get().at(0)?.id ?? "");\n    try {\n      join.run(',
  ],
]);

// (n) A passing no-op Join keeps an earlier alert: Join clears the notice
// only when the signups changed.
const noOpKeepsAlertTar = patch("bad-no-op-keeps-alert", "screen.ts", [
  [
    'import { addClass, classes, joinClass, leaveClass, setCapacity, undoGym } from "./model.ts";',
    'import { addClass, classes, joinClass, leaveClass, setCapacity, signups, undoGym } from "./model.ts";',
  ],
  [
    "    join: joinClass.controller,\n  },\n  run: ({ draft, chosen, saved, shown, join }) => {\n",
    "    join: joinClass.controller,\n    list: signups.controller,\n  },\n  run: ({ draft, chosen, saved, shown, join, list }) => {\n    const before = list.get();\n",
  ],
  [
    '    draft.update((text) => ({ ...text, member: "" }));\n    shown.set(undefined);\n',
    '    draft.update((text) => ({ ...text, member: "" }));\n    if (list.get() !== before) shown.set(undefined);\n',
  ],
]);

// (j) An empty starter: nothing at all under /work.
const emptyDir = join(work, "empty");
mkdirSync(emptyDir, { recursive: true });
const emptyTar = pack(emptyDir, join(work, "empty.tar"));

// (k) A blank Vite starter: it boots and exports nothing.
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

const BAD_CAPACITY =
  "core bad capacity text reports BadCapacity with the original value on addClass and setCapacity";
const ADD_CLASS =
  "core addClass adds at the end with the trimmed name, a number capacity, and id K<count>, one undo step each";
const PROMOTION =
  "core when a booked member leaves, the first waiting member in signup order becomes booked in place, as one step";
const LEAVE = "core leaveClass removes the signup and returns it as it was, one undo step";
const RAISE =
  "core a larger capacity books that class's waiting members first come first served, as one step";
const SET = "core setCapacity changes the capacity and returns the saved class, one undo step";
const NO_OP_JOIN =
  "core joining a class the member is already in passes with no change or undo step and returns the saved signup";
const JOIN =
  "core joinClass adds the trimmed member at the end, booked while a place is free, then waiting";
const ATOMIC = "core failed actions leave classes, signups, and undo history unchanged";
const TOO_LOW_CASE =
  "core a capacity below the booked count reports CapacityTooLow with the class id and that count";
const UNDO_CASE =
  "browser undo restores both tables and keeps form text, the chosen class, and the filter";
const TYPING = "browser typing in Name, Capacity, or Member clears an earlier alert";
const CHOOSING = "browser choosing a class or a filter clears an earlier alert";
const TWO_ROOTS = "browser two GymApps share nothing";
const LOADS =
  "browser loads empty forms, an empty Class select, both tables, the filters, and Undo";
const BROWSER_JOIN =
  "browser Join adds the chosen class and member, booked then Waiting <n>, clears Member, and keeps Class";
const FALLBACK =
  "browser Class falls back to the first class when the chosen one is gone, or to none, and then sends an empty id";
const NO_OP_ALERT =
  "browser a passing no-op Join or Set capacity clears an earlier alert and adds no undo step";
const FULL = "ACCEPTANCE gym: 43/43 pass";
const bad = (label, tar, mustFail, mustPass = []) => ({
  label,
  tar,
  want: { exit: 1, mustFail, mustPass },
});
const cases = [
  ...LAYOUT_NAMES.map((name) => ({
    label: `good layout ${name} accepts`,
    tar: layoutTar(name),
    want: { exit: 0, fullpass: FULL },
  })),
  bad("(a1) blank capacity becomes 1 rejects", blankCapacityTar, [BAD_CAPACITY], [ADD_CLASS]),
  bad("(a2) capacity 05 becomes 5 rejects", leadingZeroTar, [BAD_CAPACITY], [ADD_CLASS]),
  bad("(b) promotion books the last waiter rejects", lastWaiterTar, [PROMOTION], [LEAVE, RAISE]),
  bad("(c) the promoted signup moves to the end rejects", promotedMovesTar, [PROMOTION], [LEAVE]),
  bad("(d) a larger capacity books no waiter rejects", raiseBooksNoneTar, [RAISE], [SET]),
  bad("(e1) a no-op join adds an undo step rejects", noOpStepTar, [NO_OP_JOIN], [JOIN]),
  bad("(e2) a no-op join reports an error rejects", noOpErrorTar, [NO_OP_JOIN], [JOIN]),
  bad("(f1) a failed leave pushes a step first rejects", leaveStepFirstTar, [ATOMIC], [LEAVE]),
  bad(
    "(f2) setCapacity writes before CapacityTooLow rejects",
    setBeforeCheckTar,
    [ATOMIC, TOO_LOW_CASE],
    [SET],
  ),
  bad("(g1) undo resets the filter rejects", undoFilterTar, [UNDO_CASE]),
  bad("(g2) undo clears the Member text rejects", undoMemberTar, [UNDO_CASE]),
  bad("(g3) undo resets the chosen class rejects", undoChoiceTar, [UNDO_CASE]),
  bad("(h) typing in Member keeps the alert rejects", typingKeepsAlertTar, [TYPING], [CHOOSING]),
  bad("(i) labels linked by one fixed id rejects", fixedIdTar, [TWO_ROOTS], [LOADS]),
  bad("(l) Waiting shows no queue place rejects", waitingNoPlaceTar, [BROWSER_JOIN]),
  bad("(m) Join sends a gone class's id rejects", staleClassTar, [FALLBACK]),
  bad("(n) a no-op Join keeps the alert rejects", noOpKeepsAlertTar, [NO_OP_ALERT], [TYPING]),
  {
    label: "(j) empty starter rejects",
    tar: emptyTar,
    want: { exit: 1, allowLoadFail: true, mustFail: ["shape: src present"] },
  },
  {
    label: "(k) blank app starter rejects",
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
