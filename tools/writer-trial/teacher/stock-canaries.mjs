// Reproducible canary proofs for the stock checker.
// Builds every proof tar from the teacher-only fixture, runs the isolated
// runner in Docker, and prints one line per proof. No worker code involved.
// Usage: node tools/writer-trial/teacher/stock-canaries.mjs
// Proof tars land in /tmp and are rebuilt on every run; only the printed
// case lines and exit codes are the evidence (root saves them).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const IMAGE = "sha256:2232d27e48ef2fd605928585fe42fb214bf779d66fcb72d3f27328ed4d65d5e9";
const work = join(tmpdir(), "stock-canaries");
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "proof", "src"), { recursive: true });
mkdirSync(join(work, "proof", "tests"), { recursive: true });

const fixture = join(here, "stock-fixture");
for (const name of ["model.ts", "screen.ts", "errors.ts", "StockApp.tsx", "index.ts", "main.tsx"]) {
  cpSync(join(fixture, name), join(work, "proof", "src", name));
}
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
    return { exit: 0, line };
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

// Hidden-rows variant: keeps every move row in the DOM and hides
// non-matching ones with the hidden attribute. Filtering hides without
// deleting, so the visible-row assertions must still pass.
const hiddenTar = patch(goodTar, "good-hidden", (src) => {
  const p = join(src, "StockApp.tsx");
  const s = execFileSync("cat", [p], { encoding: "utf8" });
  const shownOld = '  const shown = filter === "All" ? all : all.filter((m) => m.item === filter);';
  const shownNew =
    '  const hidden = (m: { item: string }): boolean => filter !== "All" && m.item !== filter;';
  if (!s.includes(shownOld)) throw new Error("hidden canary anchor moved; update the script");
  const rowsOld = [
    "          {shown.map((move) => (",
    "            <MoveRow key={move.id} move={move} onEdit={(id) => open.run({ input: { id } })} />",
    "          ))}",
  ].join("\n");
  const rowsNew = [
    "          {all.map((move) => (",
    "            <tr key={move.id} hidden={hidden(move) || undefined}>",
    "              <td>{move.item}</td>",
    "              <td>{move.from}</td>",
    "              <td>{move.to}</td>",
    "              <td>{move.quantity}</td>",
    "              <td>",
    '                <button type="button" aria-label="Edit move" onClick={() => open.run({ input: { id: move.id } })}>',
    "                  Edit move",
    "                </button>",
    "              </td>",
    "            </tr>",
    "          ))}",
  ].join("\n");
  if (!s.includes(rowsOld)) throw new Error("hidden rows anchor moved; update the script");
  writeFileSync(p, s.replace(shownOld, shownNew).replace(rowsOld, rowsNew));
});

const cases = [
  ["good fixture accepts", goodTar, 0, "ACCEPTANCE stock: 44/44 pass"],
  ["hidden-rows variant accepts", hiddenTar, 0, "ACCEPTANCE stock: 44/44 pass"],
  ["empty starter rejects", emptyTar, 1, null],
  ["broken reversal atomicity rejects", atomicTar, 1, null],
  ["wrong clicked-draft text rejects", draftTar, 1, null],
];
let failed = 0;
for (const [label, tar, wantExit, wantLine] of cases) {
  const r = run(tar);
  const lineOk = wantLine === null ? true : r.line === wantLine;
  const ok = r.exit === wantExit && lineOk;
  if (!ok) failed++;
  console.log(
    `${ok ? "CANARY-PASS" : "CANARY-FAIL"} ${label} — exit ${r.exit} — ${r.line ?? "(no summary)"} — ${tar}`,
  );
  if (!ok && r.fails) for (const f of r.fails) console.log(`    ${f}`);
}
process.exitCode = failed ? 1 : 0;
