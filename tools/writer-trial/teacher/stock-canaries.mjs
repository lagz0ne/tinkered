// Reproducible canary proofs for the stock checker.
// Builds every proof tar from the teacher-only fixture, runs the isolated
// runner in Docker, and prints one line per proof. No worker code involved.
// Usage: node tools/writer-trial/teacher/stock-canaries.mjs
// Proof tars land in /tmp and are rebuilt on every run; only the printed
// case lines and exit codes are the evidence (root saves them).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const work = join(tmpdir(), "stock-canaries");
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "proof", "tests"), { recursive: true });

const fixture = join(here, "stock-fixture");
cpSync(join(fixture, "src"), join(work, "proof", "src"), { recursive: true });
cpSync(join(fixture, "index.html"), join(work, "proof", "index.html"));

const pack = (dir, tar) => {
  execFileSync("tar", ["-cf", tar, "."], { cwd: dir });
  return tar;
};
const base = join(work, "proof");
execFileSync("ln", ["-s", "/home/pwuser/toolchain/node_modules", join(base, "node_modules")]);
// Tar follows the recorded layout every run: src/, tests/, index.html plus
// the toolchain symlink the grading container provides at /work.
const goodTar = pack(base, join(work, "good.tar"));

const run = (tar) => {
  try {
    const out = execFileSync(
      "node",
      [join(repo, "tools/writer-trial/stock-acceptance.mjs"), tar, IMAGE],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    const line = out.split("\n").find((l) => l.startsWith("ACCEPTANCE"));
    return { exit: 0, line, fails: [] };
  } catch (error) {
    const out = `${error.stdout ?? ""}`;
    const line = out.split("\n").find((l) => l.startsWith("ACCEPTANCE"));
    const fails = out.split("\n").filter((l) => l.startsWith("FAIL"));
    return { exit: error.status ?? 1, line, fails };
  }
};

// An empty starter means no TypeScript under src/: the shape case names it.
const emptyDir = join(work, "empty");
mkdirSync(emptyDir, { recursive: true });
const emptyTar = pack(emptyDir, join(work, "empty.tar"));

const patch = (tar, name, fn) => {
  const dir = join(work, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["-xf", goodTar, "-C", dir]);
  rmSync(join(dir, "node_modules"), { force: true });
  fn(join(dir, "src"));
  execFileSync("ln", ["-s", "/home/pwuser/toolchain/node_modules", join(dir, "node_modules")]);
  return pack(dir, join(work, `${name}.tar`));
};

const atomicTar = patch(goodTar, "bad-atomic", (src) => {
  const p = join(src, "model.ts");
  const s = execFileSync("cat", [p], { encoding: "utf8" });
  const old = [
    "    const current = stockCell.get();",
    "    const restored = shifted(current, saved.item, saved.to, saved.from, saved.quantity);",
    "    const next = shifted(restored, field.item, field.from, field.to, field.quantity);",
  ].join("\n");
  const next = [
    "    const current = stockCell.get();",
    "    const next = shifted(current, field.item, field.from, field.to, field.quantity);",
  ].join("\n");
  if (!s.includes(old)) throw new Error("atomic canary anchor moved; update the script");
  writeFileSync(p, s.replace(old, next));
});

const draftTar = patch(goodTar, "bad-draft", (src) => {
  const p = join(src, "screen.ts");
  const s = execFileSync("cat", [p], { encoding: "utf8" });
  const anchor = "      const saved = open.run({ input: { id: ctx.input.id } });";
  if (!s.includes(anchor)) throw new Error("draft canary anchor moved; update the script");
  const seeded = [
    "      const first = list.get()[0];",
    '      if (first === undefined) throw fail("NotFound", { id: ctx.input.id });',
    "      const saved = open.run({ input: { id: first.id } });",
  ].join("\n");
  let out = s.replace(anchor, seeded);
  out = out.replace(
    "    open: openMoveEdit.controller,\n    noticeCell: notice.controller,\n  },\n  run: ({ edit, open, noticeCell }, ctx) =>",
    "    open: openMoveEdit.controller,\n    noticeCell: notice.controller,\n    list: moves.controller,\n  },\n  run: ({ edit, open, noticeCell, list }, ctx) =>",
  );
  out = out.replace(
    'import { discardMoveEdit, moveStock, openMoveEdit, saveMoveEdit } from "./model.ts";',
    'import { discardMoveEdit, moves, moveStock, openMoveEdit, saveMoveEdit } from "./model.ts";',
  );
  writeFileSync(p, out);
});

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
const layoutTar = (name) =>
  patch(goodTar, `layout-${name}`, (src) =>
    writeFileSync(
      join(src, "layout-choice.ts"),
      `export const LAYOUT_NAME: string = ${JSON.stringify(name)};\n`,
    ),
  );

// Hidden-rows variant: keeps every move row in the DOM and hides
// non-matching ones with the hidden attribute. Filtering hides without
// deleting, so the visible-row assertions must still pass. Not a layout:
// the kit's NamedTable leaves filtered rows out, so this one table is
// drawn by hand.
const hiddenTar = patch(goodTar, "good-hidden", (src) => {
  const p = join(src, "StockApp.tsx");
  const s = readFileSync(p, "utf8");
  const shownOld = '  const shown = filter === "All" ? all : all.filter((m) => m.item === filter);';
  const shownNew =
    '  const hidden = (m: { item: string }): boolean => filter !== "All" && m.item !== filter;';
  if (!s.includes(shownOld)) throw new Error("hidden canary anchor moved; update the script");
  const rowsOld = [
    "      <NamedTable",
    '        name="Moves"',
    '        headers={["Item", "From", "To", "Quantity"]}',
    "        rows={shown.map((move) => ({",
    "          key: move.id,",
    "          cells: [move.item, move.from, move.to, move.quantity],",
    "          actions: (",
    '            <button type="button" onClick={() => open.run({ input: { id: move.id } })}>',
    "              Edit move",
    "            </button>",
    "          ),",
    "        }))}",
    "      />",
  ].join("\n");
  const rowsNew = [
    '      <table aria-label="Moves">',
    "        <thead>",
    "          <tr>",
    "            <th>Item</th>",
    "            <th>From</th>",
    "            <th>To</th>",
    "            <th>Quantity</th>",
    "            <th>Actions</th>",
    "          </tr>",
    "        </thead>",
    "        <tbody>",
    "          {all.map((move) => (",
    "            <tr key={move.id} hidden={hidden(move) || undefined}>",
    "              <td>{move.item}</td>",
    "              <td>{move.from}</td>",
    "              <td>{move.to}</td>",
    "              <td>{move.quantity}</td>",
    "              <td>",
    '                <button type="button" onClick={() => open.run({ input: { id: move.id } })}>',
    "                  Edit move",
    "                </button>",
    "              </td>",
    "            </tr>",
    "          ))}",
    "        </tbody>",
    "      </table>",
  ].join("\n");
  if (!s.includes(rowsOld)) throw new Error("hidden rows anchor moved; update the script");
  writeFileSync(p, s.replace(shownOld, shownNew).replace(rowsOld, rowsNew));
});

const cases = [
  ...LAYOUT_NAMES.map((name) => [
    `good layout ${name} accepts`,
    layoutTar(name),
    0,
    "ACCEPTANCE stock: 44/44 pass",
  ]),
  ["hidden-rows variant accepts", hiddenTar, 0, "ACCEPTANCE stock: 44/44 pass"],
  ["empty starter rejects", emptyTar, 1, null, ["shape: src present"]],
  [
    "broken reversal atomicity rejects",
    atomicTar,
    1,
    null,
    ["core reversal shortage is atomic, draft stays open"],
  ],
  [
    "wrong clicked-draft text rejects",
    draftTar,
    1,
    null,
    ["browser switching rows drops unsaved text"],
  ],
];
// A bad variant passes only when each named case is among the FAIL lines.
const missingFails = (r, mustFail) =>
  mustFail.filter((name) => !r.fails.some((f) => f.startsWith(`FAIL ${name} — `)));
// `--only <label prefix>` runs a subset while tuning; a full run is the proof.
const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : "";
let failed = 0;
for (const [label, tar, wantExit, wantLine, mustFail = []] of cases.filter(([l]) =>
  l.startsWith(only),
)) {
  const r = run(tar);
  const lineOk = wantLine === null ? true : r.line === wantLine;
  const missing = missingFails(r, mustFail);
  const ok = r.exit === wantExit && lineOk && missing.length === 0;
  if (!ok) failed++;
  const caughtBy = mustFail.length > 0 ? ` — caught by: ${mustFail.join("; ")}` : "";
  const problem = missing.length > 0 ? ` — want failure ${missing.join(", ")}` : "";
  console.log(
    `${ok ? "CANARY-PASS" : "CANARY-FAIL"} ${label} — exit ${r.exit} — ${r.line ?? "(no summary)"} — ${tar}${ok ? caughtBy : problem}`,
  );
  if (!ok && r.fails) for (const f of r.fails) console.log(`    ${f}`);
}
process.exitCode = failed ? 1 : 0;
