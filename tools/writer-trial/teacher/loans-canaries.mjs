// Reproducible canary proofs for the tool library checker.
// Builds every proof tar from the teacher-only fixture, runs the isolated
// runner in Docker, and prints one line per proof. No worker code involved.
// Usage: node tools/writer-trial/teacher/loans-canaries.mjs
// Proof tars land in an owned /tmp/loans-canaries-<unique> dir and are
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
const IMAGE = "sha256:2232d27e48ef2fd605928585fe42fb214bf779d66fcb72d3f27328ed4d65d5e9";
const TOOLCHAIN = "/home/pwuser/toolchain/node_modules";
const work = join(tmpdir(), `loans-canaries-${randomUUID()}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const pack = (dir, tar) => {
  execFileSync("tar", ["-cf", tar, "."], { cwd: dir });
  return tar;
};

// The submission layout the grading container gets at /work: src/,
// index.html, and the toolchain symlink.
const fixture = join(here, "loans-fixture");
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
  const script = join(repo, "tools/writer-trial/loans-acceptance.mjs");
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
// Sections and divs wrap the parts, the Loans table comes first, the Tools
// columns are reordered with the name as a row header, and the Name input
// is tied to its label by useId.
const layoutTar = patch("good-layout", "LibraryApp.tsx", [
  [
    'import type { FormEvent, ReactElement } from "react";',
    'import { useId } from "react";\nimport type { FormEvent, ReactElement } from "react";',
  ],
  [
    "  const submit = useRun(submitTool);\n  return (",
    "  const submit = useRun(submitTool);\n  const nameId = useId();\n  return (",
  ],
  [
    [
      "      <label>",
      "        Name",
      "        <input",
      "          value={draft.name}",
      "          onChange={(event) => name.run({ input: { value: event.target.value } })}",
      "        />",
      "      </label>",
    ].join("\n"),
    [
      "      <div>",
      "        <label htmlFor={nameId}>Name</label>",
      "      </div>",
      "      <input",
      "        id={nameId}",
      "        value={draft.name}",
      "        onChange={(event) => name.run({ input: { value: event.target.value } })}",
      "      />",
    ].join("\n"),
  ],
  [
    [
      "      <td>{row.name}</td>",
      "      <td>{row.copies}</td>",
      "      <td>{row.out}</td>",
      "      <td>{row.status}</td>",
      "      <td>",
    ].join("\n"),
    [
      "      <td>",
      "        <span>{row.status}</span>",
      "      </td>",
      '      <th scope="row">{row.name}</th>',
      "      <td>{row.out}</td>",
      "      <td>{row.copies}</td>",
      "      <td>",
    ].join("\n"),
  ],
  [
    [
      "            <th>Name</th>",
      "            <th>Copies</th>",
      "            <th>Out</th>",
      "            <th>Status</th>",
      "            <th>Actions</th>",
    ].join("\n"),
    [
      '            <th scope="col">Status</th>',
      '            <th scope="col">Name</th>',
      '            <th scope="col">Out</th>',
      '            <th scope="col">Copies</th>',
      '            <th scope="col">Actions</th>',
    ].join("\n"),
  ],
  [
    [
      "      <main>",
      "        <ToolForm />",
      "        <Notice />",
      "        <ToolTable />",
      "        <LendForm />",
      "        <LoanTable />",
      "      </main>",
    ].join("\n"),
    [
      "      <div>",
      '        <section aria-label="Loans area">',
      "          <LoanTable />",
      "          <LendForm />",
      "        </section>",
      '        <section aria-label="Tools area">',
      "          <div>",
      "            <ToolTable />",
      "          </div>",
      "          <ToolForm />",
      "        </section>",
      "        <footer>",
      "          <Notice />",
      "        </footer>",
      "      </div>",
    ].join("\n"),
  ],
]);

// ---- good in-cell variant: no Actions column; each button sits
// inside the last named cell (Status, Member), as a writer did in
// loans-01. The task names the buttons, not where they go.
const inCellTar = patch("good-in-cell", "LibraryApp.tsx", [
  [
    [
      "      <td>{row.status}</td>",
      "      <td>",
      '        {row.status === "Retired" ? null : (',
    ].join("\n"),
    ["      <td>", "        {row.status}", '        {row.status === "Retired" ? null : ('].join(
      "\n",
    ),
  ],
  ["            <th>Status</th>\n            <th>Actions</th>", "            <th>Status</th>"],
  [
    "      <td>{row.member}</td>\n      <td>\n        <button",
    "      <td>\n        {row.member}\n        <button",
  ],
  ["          <th>Member</th>\n          <th>Actions</th>", "          <th>Member</th>"],
]);

// ---- bad variants: each must fail its named case ----
// (a) Blank copies text becomes 1 instead of BadCopies.
const blankCopiesTar = patch("bad-blank-copies", "model.ts", [
  [
    "function readCopies(raw: unknown): number {\n",
    'function readCopies(raw: unknown): number {\n  if (typeof raw === "string" && raw.trim() === "") return 1;\n',
  ],
]);

// (b) The copy check runs before the held-loan check, so a repeat lend
// with no copy left reports NoCopyLeft.
const noCopyTar = patch("bad-repeat-no-copy", "model.ts", [
  [
    '    if (loansOf(rows, tool.id).length >= tool.copies) throw fail("NoCopyLeft", { id: tool.id });\n',
    "",
  ],
  [
    "    if (held !== undefined) return held;\n",
    '    if (loansOf(rows, tool.id).length >= tool.copies) throw fail("NoCopyLeft", { id: tool.id });\n    if (held !== undefined) return held;\n',
  ],
]);

// (c) The open-loan check runs before the retired check, so retiring a
// retired tool with open loans reports OnLoan.
const onLoanTar = patch("bad-retire-repeat-on-loan", "model.ts", [
  [
    '    if (tool.retired) return tool;\n    const loanIds = loansOf(cells.loans.get(), tool.id).map((loan) => loan.id);\n    if (loanIds.length > 0) throw fail("OnLoan", { id: tool.id, loanIds });\n',
    '    const loanIds = loansOf(cells.loans.get(), tool.id).map((loan) => loan.id);\n    if (loanIds.length > 0) throw fail("OnLoan", { id: tool.id, loanIds });\n    if (tool.retired) return tool;\n',
  ],
]);

// (d) Choosing a filter leaves an earlier alert on screen.
const filterAlertTar = patch("bad-filter-keeps-alert", "screen.ts", [
  [
    "  run: ({ filter, shown }, { input }) => {\n    filter.set(input);\n    shown.set(undefined);\n",
    "  run: ({ filter, shown }, { input }) => {\n    filter.set(input);\n    void shown;\n",
  ],
]);

// (e1) Undo also puts the filter back to All.
const undoFilterTar = patch("bad-undo-resets-filter", "screen.ts", [
  [
    "  depends: { shown: notice.controller, undo: undoLibrary.controller },\n  run: ({ shown, undo }) => {\n",
    '  depends: { shown: notice.controller, undo: undoLibrary.controller, filter: toolFilter.controller },\n  run: ({ shown, undo, filter }) => {\n    filter.set("All");\n',
  ],
]);

// (e2) Undo also clears the typed new-tool text.
const undoTextTar = patch("bad-undo-clears-text", "screen.ts", [
  [
    "  depends: { shown: notice.controller, undo: undoLibrary.controller },\n  run: ({ shown, undo }) => {\n",
    "  depends: { shown: notice.controller, undo: undoLibrary.controller, draft: toolDraft.controller },\n  run: ({ shown, undo, draft }) => {\n    draft.set(emptyTool);\n",
  ],
]);

// (f1) An empty starter: nothing at all under /work.
const emptyDir = join(work, "empty");
mkdirSync(emptyDir, { recursive: true });
const emptyTar = pack(emptyDir, join(work, "empty.tar"));

// (f2) A blank Vite starter: it boots and exports nothing.
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

const UNDO_CASE = "browser undo restores records and keeps form text, tool, and filter";
const FULL = "ACCEPTANCE loans: 53/53 pass";
const cases = [
  { label: "good fixture accepts", tar: goodTar, want: { exit: 0, fullpass: FULL } },
  { label: "good layout variant accepts", tar: layoutTar, want: { exit: 0, fullpass: FULL } },
  { label: "good in-cell buttons accept", tar: inCellTar, want: { exit: 0, fullpass: FULL } },
  {
    label: "(a) blank copies becomes 1 rejects",
    tar: blankCopiesTar,
    want: {
      exit: 1,
      mustFail: ["core bad copies text reports BadCopies with the original value"],
      mustPass: ["core add trims the name, parses copies, and appends in order"],
    },
  },
  {
    label: "(b) repeat lend with no copy left reports NoCopyLeft rejects",
    tar: noCopyTar,
    want: {
      exit: 1,
      mustFail: ["core repeat lend passes even with no copy left"],
      mustPass: [
        "core repeat lend returns the existing loan with no undo step",
        "core repeat lend passes even at the member limit",
      ],
    },
  },
  {
    label: "(c) retire repeat with open loans reports OnLoan rejects",
    tar: onLoanTar,
    want: {
      exit: 1,
      mustFail: ["core retire repeat passes even with open loans"],
      mustPass: [
        "core retire repeat passes with no undo step",
        "core retire with open loans reports OnLoan in saved loan order",
      ],
    },
  },
  {
    label: "(d) filtering keeps the alert rejects",
    tar: filterAlertTar,
    want: {
      exit: 1,
      mustFail: ["browser filtering clears an earlier alert"],
      mustPass: ["browser typing clears an earlier alert"],
    },
  },
  {
    label: "(e1) undo resets the filter rejects",
    tar: undoFilterTar,
    want: { exit: 1, mustFail: [UNDO_CASE] },
  },
  {
    label: "(e2) undo clears the form text rejects",
    tar: undoTextTar,
    want: { exit: 1, mustFail: [UNDO_CASE] },
  },
  {
    label: "(f1) empty starter rejects",
    tar: emptyTar,
    want: { exit: 1, allowLoadFail: true, mustFail: ["shape: src present"] },
  },
  {
    label: "(f2) blank app starter rejects",
    tar: starterTar,
    want: {
      exit: 1,
      allowLoadFail: true,
      mustFail: ["core entry exports exactly the named API"],
    },
  },
];

let failed = 0;
for (const { label, tar, want } of cases) {
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
