// Reproducible canary proofs for the booking checkers (rounds 1-5).
// Builds every proof tar from the teacher-only fixture, runs the isolated
// runners in Docker, and prints one line per proof. No worker code involved,
// except the saved known-good apps named below, which are read as tars.
// Usage: node tools/writer-trial/teacher/booking-canaries.mjs [--only <label prefix>] [--jobs N]
// Proof tars land in an owned /tmp/booking-canaries-<unique> dir and are
// rebuilt on every run; only the printed case lines and exit codes are
// the evidence.
//
// A booking round is checked the way attempts.mjs names it: rounds 1-3 by
// `evaluate.mjs <archive> <round> <image>`, round 4 by `acceptance.mjs
// <archive> repair <image>`, round 5 by `acceptance.mjs <archive> transfer
// <image>`. Every layout in teacher/layout-kit must pass all five.
import { execFile, execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
// tinker-writer-trial:20260925, built 2026-09-25 from the current core and
// react builds (context: ~/.local/share/tinker-writer-trial/image-20260925).
// WRITER_TRIAL_IMAGE reruns these proofs on a rebuilt image (the pinned one can be lost
// when the host is rebuilt); the pinned ID stays the default and the recorded evidence.
const IMAGE =
  process.env.WRITER_TRIAL_IMAGE ??
  "sha256:ac6b1e42b3f428180c6f5109a76b238a2da5a1f4874d3750b8c1088ba36e9881";
const TOOLCHAIN = "/home/pwuser/toolchain/node_modules";
const LAYOUT_NAMES = ["baseline", "L1", "L2", "L3", "L4"];
const work = join(tmpdir(), `booking-canaries-${randomUUID()}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const pack = (dir, tar) => {
  execFileSync("tar", ["-cf", tar, "."], { cwd: dir });
  return tar;
};

// The submission layout the grading container gets at /work: src/,
// index.html, and the toolchain symlink.
const fixture = join(here, "booking-fixture");
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
const variant = (name, files) => {
  const dir = join(work, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(base, dir, { recursive: true, verbatimSymlinks: true });
  for (const [file, swaps] of Object.entries(files)) {
    const path = join(dir, "src", file);
    let text = existsSync(path) ? readFileSync(path, "utf8") : "";
    for (const swap of swaps) text = edit(text, swap, name);
    writeFileSync(path, text);
  }
  return pack(dir, join(work, `${name}.tar`));
};

// ---- the fixture once per layout ----
const CHOICE = 'export const LAYOUT_NAME: string = "baseline";';
const layoutTar = (name) =>
  variant(`layout-${name}`, {
    "layout-choice.ts": [[CHOICE, `export const LAYOUT_NAME: string = "${name}";`]],
  });

// ---- bad variants on the baseline layout: each must fail its named case ----
// (a) The list sorts by date and start only; ties keep list position, so an
// edit that moves an older booking onto a newer one's time puts it second.
const tiesTar = variant("bad-ties-after-edit", {
  "model.ts": [["      order.indexOf(left.id) - order.indexOf(right.id),\n", "      0,\n"]],
});

// (b) Opening a second draft keeps the first draft's typed text.
const keepDraftTar = variant("bad-second-draft-keeps-text", {
  "screen.ts": [
    ["  discardEdit,\n", "  discardEdit,\n  editDraft,\n"],
    [
      [
        "  depends: { form: editForm.controller, shown: notice.controller, open: openEdit.controller },",
        "  run: ({ form, shown, open }, { input }) => {",
        "    try {",
        "      const booking = open.run({ input });",
        "      form.set({",
      ].join("\n"),
      [
        "  depends: {",
        "    form: editForm.controller,",
        "    shown: notice.controller,",
        "    open: openEdit.controller,",
        "    draft: editDraft.controller,",
        "  },",
        "  run: ({ form, shown, open, draft }, { input }) => {",
        "    try {",
        "      const was = draft.get();",
        "      const booking = open.run({ input });",
        "      if (was === undefined) form.set({",
      ].join("\n"),
    ],
  ],
});

// (c) A cleared Date field is left out of the call, so it books the default day.
const clearedDateTar = variant("bad-cleared-date-defaults", {
  "screen.ts": [
    [
      [
        "  depends: { form: bookForm.controller, shown: notice.controller, book: bookBooking.controller },",
        "  run: ({ form, shown, book }) => {",
        "    const text = form.get();",
        "    try {",
        "      book.run({",
        "        input: {",
        "          title: text.title,",
        "          room: text.room,",
        "          date: text.date,",
      ].join("\n"),
      [
        "  depends: { form: bookForm.controller, shown: notice.controller, book: bookBooking.controller },",
        "  run: ({ form, shown, book }) => {",
        "    const text = form.get();",
        "    try {",
        "      book.run({",
        "        input: {",
        "          title: text.title,",
        "          room: text.room,",
        '          ...(text.date === "" ? {} : { date: text.date }),',
      ].join("\n"),
    ],
  ],
});

// (d) Every label links to its control by one fixed id, so a second mounted
// app's labels point at the first app's fields.
const FIXED_ID_SWAPS = [
  [
    ["  return (", "    <label>", "      {name}", "      {control}", "    </label>", "  );"].join(
      "\n",
    ),
    [
      '  const fixedId = `field-${name.replaceAll(" ", "-")}`;',
      "  return (",
      "    <span>",
      "      <label htmlFor={fixedId}>{name}</label>",
      "      {cloneElement(control, { id: fixedId })}",
      "    </span>",
      "  );",
    ].join("\n"),
  ],
];

const fixedIdTar = variant("bad-fixed-label-ids", { "layout.tsx": FIXED_ID_SWAPS });

// (d2) The same fixed ids with Room as a text input, so the fields sit in the
// order a positional fallback would guess.
const fixedIdTextRoomTar = variant("bad-fixed-label-ids-text-room", {
  "layout.tsx": FIXED_ID_SWAPS,
  "BookingApp.tsx": [
    [
      [
        '        name="Room"',
        "        control={",
        '          <select value={text.room} onChange={typed("room")}>',
        "            <RoomOptions />",
        "          </select>",
        "        }",
      ].join("\n"),
      '        name="Room"\n        control={<input value={text.room} onChange={typed("room")} />}',
    ],
  ],
});

// (e) Undo also resets one piece of screen state it must leave alone.
const UNDO = [
  "  depends: { shown: notice.controller, undo: undoChange.controller },",
  "  run: ({ shown, undo }) => {",
  "",
].join("\n");
const undoResets = (name, cell, write) =>
  variant(name, {
    "screen.ts": [
      [
        UNDO,
        [
          `  depends: { shown: notice.controller, undo: undoChange.controller, reset: ${cell}.controller },`,
          "  run: ({ shown, undo, reset }) => {",
          `    ${write}`,
          "",
        ].join("\n"),
      ],
    ],
  });
const undoFilterTar = undoResets("bad-undo-resets-filter", "roomFilter", 'reset.set("All");');
const undoDraftTextTar = undoResets(
  "bad-undo-clears-draft-text",
  "editForm",
  'reset.set({ title: "", room: "Cedar", date: DEFAULT_DATE, start: "", end: "" });',
);
const undoFormTextTar = undoResets(
  "bad-undo-clears-form-title",
  "bookForm",
  'reset.update((now) => ({ ...now, title: "" }));',
);

// (f) An empty app: nothing at all under /work.
const emptyDir = join(work, "empty");
mkdirSync(emptyDir, { recursive: true });
const emptyTar = pack(emptyDir, join(work, "empty.tar"));

// ---- saved known-good worker apps ----
const trials = join(homedir(), ".local/share/tinker-writer-trial");
const growRound5 = join(trials, "grow-01/results/round-5");
const newestGrow = () => {
  const attempts = readdirSync(growRound5)
    .map((dir) => /^worker-1-attempt-(\d+)$/.exec(dir))
    .filter((m) => m !== null && existsSync(join(growRound5, m[0], "archive.tar")))
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  if (attempts.length === 0) throw new Error(`no grow-01 round-5 archive under ${growRound5}`);
  return join(growRound5, attempts.at(-1)[0], "archive.tar");
};
// learn-01 worker-4 links each label to its field by a useId id. useId repeats in every
// separately mounted root, so its second root's labels name the first root's fields: the
// break guidelines.md forbids since grow-01 (4a362c5) and variant (d) plants. The old
// two-roots case passed it only through a positional-input fallback, which also let (d)
// through whenever Room is a text input (d2). That one case is its known, named failure;
// every other case of all five rounds must pass.
const TWO_ROOTS = "browser: two roots on one page share nothing";
const SAVED = [
  {
    label: "learn-01 transfer-1 worker-3",
    tar: join(trials, "learn-01/results/transfer-1/worker-3.tar"),
    known: {},
  },
  {
    label: "learn-01 transfer-2 worker-4",
    tar: join(trials, "learn-01/results/transfer-2/worker-4.tar"),
    known: { "round 4 repair": [TWO_ROOTS], "round 5 transfer": [TWO_ROOTS] },
  },
  { label: "grow-01 round-5 final", tar: newestGrow(), known: {} },
];

// ---- running one check ----
const runAsync = (script, args) =>
  new Promise((done) => {
    execFile(
      "node",
      [join(repo, "tools/writer-trial", script), ...args],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 400000 },
      (error, stdout, stderr) => {
        done({
          exit: error ? (error.code ?? 1) : 0,
          out: `${stdout ?? ""}`,
          err: `${stderr ?? ""}`,
        });
      },
    );
  });

// A case line is `PASS <name>[ — detail]` or `FAIL <name> — error`.
const casesOf = (out) =>
  new Map(
    out
      .split("\n")
      .filter((l) => l.startsWith("PASS ") || l.startsWith("FAIL "))
      .map((l) => [l.slice(5).split(" — ")[0], l.startsWith("PASS ")]),
  );

// The five round checks attempts.mjs names, each with its full-pass proof.
const ROUND_CHECKS = [
  ...[1, 2, 3].map((round) => ({
    label: `round ${round}`,
    run: (tar) => runAsync("evaluate.mjs", [tar, String(round), IMAGE]),
    full: (r) =>
      r.exit === 0 &&
      r.out.includes(`teacher check round ${round}: pass`) &&
      r.out.includes(`teacher browser round ${round}: pass`),
    summary: (r) => (r.exit === 0 ? "pass" : `exit ${r.exit}`),
  })),
  ...["repair", "transfer"].map((mode, i) => ({
    label: `round ${4 + i} ${mode}`,
    run: (tar) => runAsync("acceptance.mjs", [tar, mode, IMAGE]),
    full: (r) => {
      const m = new RegExp(`^ACCEPTANCE ${mode}: (\\d+)/(\\d+) pass$`, "m").exec(r.out);
      return r.exit === 0 && m !== null && m[1] === m[2] && Number(m[2]) > 0;
    },
    summary: (r) =>
      (/^ACCEPTANCE .*$/m.exec(r.out) ?? [`exit ${r.exit}, no summary`])[0].replace(
        "ACCEPTANCE ",
        "",
      ),
  })),
];

// The failing lines of one run, for a canary that did not hold.
const evidence = (r) =>
  [
    ...r.out.split("\n").filter((l) => l.startsWith("FAIL ")),
    ...r.err
      .split("\n")
      .filter((l) => /Error|assert|expected|want|Timeout/i.test(l))
      .slice(0, 6),
  ].map((l) => `    ${l.slice(0, 400)}`);

// `known` names, per check label, the exact cases a saved app is known to fail; the run
// then holds only when those cases, and no others, fail.
const sameSet = (a, b) => a.length === b.length && a.every((n) => b.includes(n));
const judgeKnown = (r, fails, expected) => {
  const ok = r.exit !== 0 && sameSet(fails, expected);
  const tail = ok
    ? `known FAIL ${expected.join("; ")}`
    : `want only FAIL ${expected.join("; ")}; FAIL ${fails.join("; ") || "(none)"}`;
  return { ok, tail: ` — ${tail}` };
};
const judgeFull = (check, r, fails) => {
  const ok = check.full(r);
  if (ok) return { ok, tail: "" };
  const listed = fails.length ? `; FAIL ${fails.join("; ")}` : "";
  return { ok, tail: ` — want full pass${listed}${r.out.trim() === "" ? "; no output" : ""}` };
};
const goodJobs = (label, tar, known = {}) =>
  ROUND_CHECKS.map((check) => ({
    label: `${label} — ${check.label}`,
    go: async () => {
      const r = await check.run(tar);
      const fails = [...casesOf(r.out)].filter(([, pass]) => !pass).map(([name]) => name);
      const expected = known[check.label] ?? [];
      const { ok, tail } = expected.length
        ? judgeKnown(r, fails, expected)
        : judgeFull(check, r, fails);
      return { ok, line: `${check.summary(r)}${tail}`, more: ok ? [] : evidence(r) };
    },
  }));

const badJob = (label, tar, want) => ({
  label,
  go: async () => {
    const r = await runAsync("acceptance.mjs", [tar, "transfer", IMAGE]);
    const cases = casesOf(r.out);
    const missing = want.mustFail.filter((n) => cases.get(n) !== false);
    const wrong = (want.mustPass ?? []).filter((n) => cases.get(n) !== true);
    const problems = [
      r.exit === 0 ? "want exit 1, got 0" : "",
      missing.length ? `want FAIL ${missing.join("; ")}` : "",
      wrong.length ? `want PASS ${wrong.join("; ")}` : "",
    ].filter(Boolean);
    const summary = (/^ACCEPTANCE .*$/m.exec(r.out) ?? [`exit ${r.exit}`])[0];
    return {
      ok: problems.length === 0,
      more: problems.length === 0 ? [] : evidence(r),
      line: `${summary} — ${problems.length ? problems.join(" — ") : `caught by: ${want.mustFail.join("; ")}`}`,
    };
  },
});

const R4 = "browser r4: undo keeps draft text and filter choice";
const jobs = [
  ...LAYOUT_NAMES.flatMap((name) => goodJobs(`layout ${name}`, layoutTar(name))),
  badJob("(a) tied start times lose creation order after an edit", tiesTar, {
    mustFail: ["core regression: creation-order ties after edits"],
    mustPass: ["core r1: order by start then creation"],
  }),
  badJob("(b) opening a second draft keeps the first draft's text", keepDraftTar, {
    mustFail: ["browser r2: switch drafts drops unsaved, discard, save"],
    mustPass: ["core r2: second open drops first draft"],
  }),
  badJob("(c) a cleared Date field books the default day", clearedDateTar, {
    mustFail: ["browser regression: cleared Date is BadDate and saves nothing"],
    mustPass: ["core r3: invalid and blank dates BadDate, bad weeks BadCount"],
  }),
  badJob("(d) labels linked by one fixed id across roots", fixedIdTar, {
    mustFail: [TWO_ROOTS],
    mustPass: ["browser r1: book, clash keeps form, filter preserves"],
  }),
  badJob("(d2) fixed label ids with a text Room input", fixedIdTextRoomTar, {
    mustFail: [TWO_ROOTS],
    mustPass: ["browser r1: book, clash keeps form, filter preserves"],
  }),
  badJob("(e1) undo resets the filter", undoFilterTar, {
    mustFail: [R4],
    mustPass: ["core r4: undo preserves open draft"],
  }),
  badJob("(e2) undo clears the draft text", undoDraftTextTar, { mustFail: [R4] }),
  badJob("(e3) undo clears the form title", undoFormTextTar, { mustFail: [R4] }),
  badJob("(f) empty app", emptyTar, { mustFail: ["shape: src present"] }),
  ...SAVED.flatMap(({ label, tar, known }) => goodJobs(`saved ${label}`, tar, known)),
];

// `--only <label prefix>` runs a subset while tuning; a full run is the proof.
const flag = (name, fallback) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const only = flag("--only", "");
const width = Math.max(1, Number(flag("--jobs", "4")));
const chosen = jobs.filter((j) => j.label.startsWith(only));
let failed = 0;
let next = 0;
const worker = async () => {
  while (next < chosen.length) {
    const job = chosen[next++];
    const { ok, line, more } = await job.go();
    if (!ok) failed++;
    console.log(
      [`${ok ? "CANARY-PASS" : "CANARY-FAIL"} ${job.label} — ${line}`, ...more].join("\n"),
    );
  }
};
await Promise.all(Array.from({ length: width }, worker));
console.log(`BOOKING CANARIES: ${chosen.length - failed}/${chosen.length} pass`);
rmSync(work, { recursive: true, force: true });
process.exitCode = failed || chosen.length === 0 ? 1 : 0;
