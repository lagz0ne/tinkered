// Reproducible canary proofs for the parcel locker checker.
// Builds every proof tar from the teacher-only fixture, runs the isolated
// runner in Docker, and prints one line per proof. No worker code involved.
// Usage: node tools/writer-trial/teacher/locker-canaries.mjs
// Proof tars land in an owned /tmp/locker-canaries-<unique> dir and are
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
// tinker-writer-trial:20260922 rebuilt on 2026-09-24 from the unchanged
// frozen context in ~/.local/share/tinker-writer-trial/image: the earlier
// build (sha256:2232d27e…) is no longer on this host.
// WRITER_TRIAL_IMAGE reruns these proofs on a rebuilt image (the pinned one can be lost
// when the host is rebuilt); the pinned ID stays the default and the recorded evidence.
const IMAGE =
  process.env.WRITER_TRIAL_IMAGE ??
  "sha256:91630289b0b742330f6d31ed61f96f4418793526895b252dccb4b6cf0529787c";
const TOOLCHAIN = "/home/pwuser/toolchain/node_modules";
const work = join(tmpdir(), `locker-canaries-${randomUUID()}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const pack = (dir, tar) => {
  execFileSync("tar", ["-cf", tar, "."], { cwd: dir });
  return tar;
};

// The submission layout the grading container gets at /work: src/,
// index.html, and the toolchain symlink.
const fixture = join(here, "locker-fixture");
const base = join(work, "good");
mkdirSync(base, { recursive: true });
cpSync(join(fixture, "src"), join(base, "src"), { recursive: true });
cpSync(join(fixture, "index.html"), join(base, "index.html"));
execFileSync("ln", ["-s", TOOLCHAIN, join(base, "node_modules")]);
const goodTar = pack(base, join(work, "good.tar"));

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
  const script = join(repo, "tools/writer-trial/locker-acceptance.mjs");
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

// ---- good layout variant: same roles and names, different DOM ----
// Sections and divs wrap the parts, the Parcels table comes first, its
// columns are reordered with the recipient as a row header, and the
// Locker input is tied to its label by useId.
const layoutTar = patch("good-layout", "LockerApp.tsx", [
  [
    'import type { FormEvent, ReactElement } from "react";',
    'import { useId } from "react";\nimport type { FormEvent, ReactElement } from "react";',
  ],
  [
    "  const submit = useRun(submitStore);\n  return (",
    "  const submit = useRun(submitStore);\n  const lockerId = useId();\n  return (",
  ],
  [
    [
      "      <label>",
      "        Locker",
      "        <input",
      "          value={draft.locker}",
      "          onChange={(event) => locker.run({ input: { value: event.target.value } })}",
      "        />",
      "      </label>",
    ].join("\n"),
    [
      "      <div>",
      "        <label htmlFor={lockerId}>Locker</label>",
      "      </div>",
      "      <input",
      "        id={lockerId}",
      "        value={draft.locker}",
      "        onChange={(event) => locker.run({ input: { value: event.target.value } })}",
      "      />",
    ].join("\n"),
  ],
  [
    [
      "      <td>{row.recipient}</td>",
      "      <td>{row.size}</td>",
      '      <td>{row.locker ?? "None"}</td>',
      "      <td>{row.state}</td>",
      "      <td>",
    ].join("\n"),
    [
      "      <td>",
      "        <span>{row.state}</span>",
      "      </td>",
      '      <td>{row.locker ?? "None"}</td>',
      '      <th scope="row">{row.recipient}</th>',
      "      <td>{row.size}</td>",
      "      <td>",
    ].join("\n"),
  ],
  [
    [
      "            <th>Recipient</th>",
      "            <th>Size</th>",
      "            <th>Locker</th>",
      "            <th>State</th>",
      "            <th>Actions</th>",
    ].join("\n"),
    [
      '            <th scope="col">State</th>',
      '            <th scope="col">Locker</th>',
      '            <th scope="col">Recipient</th>',
      '            <th scope="col">Size</th>',
      '            <th scope="col">Actions</th>',
    ].join("\n"),
  ],
  [
    [
      "      <main>",
      "        <ReceiveForm />",
      "        <StoreForm />",
      "        <Notice />",
      "        <ParcelTable />",
      "      </main>",
    ].join("\n"),
    [
      "      <div>",
      '        <section aria-label="Parcel area">',
      "          <div>",
      "            <ParcelTable />",
      "          </div>",
      "        </section>",
      '        <section aria-label="Desk area">',
      "          <StoreForm />",
      "          <ReceiveForm />",
      "        </section>",
      "        <footer>",
      "          <Notice />",
      "        </footer>",
      "      </div>",
    ].join("\n"),
  ],
]);

// ---- good in-cell variant: no Actions column; Collect and Return sit
// inside the State cell. The task names the buttons, not where they go.
const inCellTar = patch("good-in-cell", "LockerApp.tsx", [
  [
    "      <td>{row.state}</td>\n      <td>\n        <RowButtons row={row} />",
    "      <td>\n        {row.state}\n        <RowButtons row={row} />",
  ],
  ["            <th>State</th>\n            <th>Actions</th>", "            <th>State</th>"],
]);

// ---- bad variants: each must fail its named case ----
// (a) Blank locker text becomes locker 1 instead of BadLocker.
const blankLockerTar = patch("bad-blank-locker", "model.ts", [
  [
    "function readLocker(raw: unknown): Locker {\n",
    'function readLocker(raw: unknown): Locker {\n  if (typeof raw === "string" && raw.trim() === "") return LOCKERS[0];\n',
  ],
]);

// The same-locker check and the AlreadyStored guard after it in
// storeParcel, in the fixture's order.
const SAME_LOCKER = "      if (parcel.locker === locker.number) return parcel;\n";
const STORED_GUARD = [
  "      if (parcel.locker !== null)\n",
  '        throw fail("AlreadyStored", { id: parcel.id, locker: parcel.locker });\n',
].join("");

// (b) The AlreadyStored guard runs before the same-locker check, so
// re-storing a parcel in its own locker reports AlreadyStored.
const sameLockerTar = patch("bad-same-locker-already-stored", "model.ts", [
  [SAME_LOCKER + STORED_GUARD, STORED_GUARD + SAME_LOCKER],
]);

const ALREADY_COLLECTED = '    if (parcel.state === "collected") return parcel;\n';
const NOT_STORED = '    if (parcel.state === "held") throw fail("NotStored", { id: parcel.id });\n';

// (c1) No already-collected check: collecting a collected parcel writes it
// again and adds an undo step.
const collectTwiceStepTar = patch("bad-collect-twice-step", "model.ts", [
  [ALREADY_COLLECTED + NOT_STORED, NOT_STORED],
]);

// (c2) Collecting a collected parcel reports NotStored.
const collectTwiceErrorTar = patch("bad-collect-twice-error", "model.ts", [
  [
    ALREADY_COLLECTED + NOT_STORED,
    '    if (parcel.state !== "stored") throw fail("NotStored", { id: parcel.id });\n',
  ],
]);

// (d) An M parcel fits an S locker.
const mediumInSmallTar = patch("bad-medium-fits-small", "model.ts", [
  [
    "const RANK: Readonly<Record<Size, number>> = { S: 1, M: 2, L: 3 };",
    "const RANK: Readonly<Record<Size, number>> = { S: 1, M: 1, L: 3 };",
  ],
]);

const COLLECT_HEAD = [
  '  label: "collectParcel",',
  "  depends: deskCells,",
  "  run: (cells, { rawInput }) => {",
  "    const rows = cells.parcels.get();",
  '    const parcel = findParcel(rows, fieldOf(rawInput, "parcelId"));',
].join("\n");

// (e1) collectParcel gets an input reader and trusts ctx.input: a
// `{ rawInput }` call is read to text, but a `{ input }` call skips the
// reader, so a non-text id reaches NotFound as it came (a number).
const inputPayloadTar = patch("bad-input-id-not-text", "model.ts", [
  [
    COLLECT_HEAD,
    [
      '  label: "collectParcel",',
      "  depends: deskCells,",
      "  input: (raw: unknown) => {",
      '    const id = fieldOf(raw, "parcelId");',
      '    return { parcelId: typeof id === "string" ? id : "" };',
      "  },",
      "  run: (cells, { input }) => {",
      "    const rows = cells.parcels.get();",
      "    const parcel = rows.find((row) => row.id === input.parcelId);",
      '    if (parcel === undefined) throw fail("NotFound", { id: input.parcelId });',
    ].join("\n"),
  ],
]);

// (e2) collectParcel reads ctx.input with no reader: a `{ rawInput }` call
// leaves ctx.input undefined and the body throws a TypeError.
const rawInputCrashTar = patch("bad-raw-input-crash", "model.ts", [
  [
    COLLECT_HEAD,
    [
      '  label: "collectParcel",',
      "  depends: deskCells,",
      "  run: (cells, { input }) => {",
      "    const rows = cells.parcels.get();",
      "    const parcel = findParcel(rows, input.parcelId);",
    ].join("\n"),
  ],
]);

// (f) The Held filter also shows stored parcels.
const heldShowsStoredTar = patch("bad-held-shows-stored", "screen.ts", [
  [
    '  filter === "All" || filter === state;\n',
    '  filter === "All" || filter === state || (filter === "Held" && state === "Stored");\n',
  ],
]);

const UNDO_ANCHOR =
  "  depends: { shown: notice.controller, undo: undoDesk.controller },\n  run: ({ shown, undo }) => {\n";

// (g1) Undo also puts the filter back to All.
const undoFilterTar = patch("bad-undo-resets-filter", "screen.ts", [
  [
    UNDO_ANCHOR,
    '  depends: { shown: notice.controller, undo: undoDesk.controller, filter: parcelFilter.controller },\n  run: ({ shown, undo, filter }) => {\n    filter.set("All");\n',
  ],
]);

// (g2) Undo also clears the typed receive text.
const undoTextTar = patch("bad-undo-clears-text", "screen.ts", [
  [
    UNDO_ANCHOR,
    "  depends: { shown: notice.controller, undo: undoDesk.controller, draft: receiveDraft.controller },\n  run: ({ shown, undo, draft }) => {\n    draft.set(emptyReceive);\n",
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

const UNDO_CASE =
  "browser undo restores records and keeps form text, the chosen parcel, and the filter";
const COLLECT_NOOP = "core collecting a collected parcel passes with no change or undo step";
const INPUT_ID = "core a non-text parcelId passed as { input } reports NotFound with a text id";
const RAW_ID = "core a non-text parcelId passed as { rawInput } reports NotFound with a text id";
const FULL = "ACCEPTANCE locker: 50/50 pass";
const cases = [
  { label: "good fixture accepts", tar: goodTar, want: { exit: 0, fullpass: FULL } },
  { label: "good layout variant accepts", tar: layoutTar, want: { exit: 0, fullpass: FULL } },
  { label: "good in-cell buttons accept", tar: inCellTar, want: { exit: 0, fullpass: FULL } },
  {
    label: "(a) blank locker becomes 1 rejects",
    tar: blankLockerTar,
    want: {
      exit: 1,
      mustFail: ["core bad locker text reports BadLocker with the original value"],
      mustPass: ["core storeParcel stores a held parcel in a locker with one undo step"],
    },
  },
  {
    label: "(b) re-storing in the same locker reports AlreadyStored rejects",
    tar: sameLockerTar,
    want: {
      exit: 1,
      mustFail: [
        "core storing a parcel in the locker it is already in passes with no change or undo step",
      ],
      mustPass: [
        "core storing a stored parcel in another locker reports AlreadyStored with its locker",
      ],
    },
  },
  {
    label: "(c1) collecting a collected parcel adds an undo step rejects",
    tar: collectTwiceStepTar,
    want: {
      exit: 1,
      mustFail: [COLLECT_NOOP],
      mustPass: ["core collectParcel collects a stored parcel with no locker and one undo step"],
    },
  },
  {
    label: "(c2) collecting a collected parcel reports an error rejects",
    tar: collectTwiceErrorTar,
    want: {
      exit: 1,
      mustFail: [COLLECT_NOOP],
      mustPass: ["core collecting a held parcel reports NotStored"],
    },
  },
  {
    label: "(d) an M parcel fits an S locker rejects",
    tar: mediumInSmallTar,
    want: {
      exit: 1,
      mustFail: ["core a locker smaller than the parcel reports TooSmall with the locker and size"],
      mustPass: ["core a locker that holds another parcel reports LockerBusy"],
    },
  },
  {
    label: "(e1) a non-text parcelId passed as { input } reaches NotFound as a number rejects",
    tar: inputPayloadTar,
    want: { exit: 1, mustFail: [INPUT_ID], mustPass: [RAW_ID] },
  },
  {
    label: "(e2) a { rawInput } call on a body with no reader crashes rejects",
    tar: rawInputCrashTar,
    want: { exit: 1, mustFail: [RAW_ID], mustPass: [INPUT_ID] },
  },
  {
    label: "(f) Held filter also shows stored parcels rejects",
    tar: heldShowsStoredTar,
    want: {
      exit: 1,
      mustFail: ["browser filters show only parcels in that state and update live"],
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
