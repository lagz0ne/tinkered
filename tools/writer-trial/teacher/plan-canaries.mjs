// Reproducible canary proofs for the plan checker.
// Builds every proof tar from the teacher-only fixture, runs the isolated
// runner in Docker, and prints one line per proof. No worker code involved.
// Usage: node tools/writer-trial/teacher/plan-canaries.mjs
// Proof tars land in an owned /tmp/plan-canaries-<unique> dir and are
// rebuilt on every run; only the printed case lines and exit codes are
// the evidence (root saves them).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const IMAGE = "sha256:2232d27e48ef2fd605928585fe42fb214bf779d66fcb72d3f27328ed4d65d5e9";
const work = join(tmpdir(), `plan-canaries-${randomUUID()}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "proof", "src"), { recursive: true });
mkdirSync(join(work, "proof", "tests"), { recursive: true });

const fixture = join(here, "plan-fixture");
for (const name of ["model.ts", "screen.ts", "errors.ts", "PlanApp.tsx", "index.ts", "main.tsx"]) {
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
      [join(repo, "tools/writer-trial/plan-acceptance.mjs"), tar, IMAGE],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 330000 },
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

// Long-cycle bug: only direct back-links are refused, so a three-course
// cycle slips through.
const cycleTar = patch(goodTar, "bad-cycle", (src) => {
  const p = join(src, "model.ts");
  const s = execFileSync("cat", [p], { encoding: "utf8" });
  const anchor = "    if (reaches(rows, prerequisiteId, courseId))";
  if (!s.includes(anchor)) throw new Error("cycle canary anchor moved; update the script");
  writeFileSync(p, s.replace(anchor, "    if (course.prerequisiteIds.includes(courseId))"));
});

// Early-mutation bug: the course row is written before the cycle check,
// so a rejected link still mutates the saved plan.
const mutationTar = patch(goodTar, "bad-mutation", (src) => {
  const p = join(src, "model.ts");
  const s = execFileSync("cat", [p], { encoding: "utf8" });
  const anchor = "    if (reaches(rows, prerequisiteId, courseId))";
  if (!s.includes(anchor)) throw new Error("mutation canary anchor moved; update the script");
  const mutated = [
    "    coursesCell.set(rows.map((row) => (row.id === courseId ? { ...course, prerequisiteIds: [...course.prerequisiteIds, prerequisiteId] } : row)));",
    "    if (reaches(rows, prerequisiteId, courseId))",
  ].join("\n");
  writeFileSync(p, s.replace(anchor, mutated));
});

// Stale-ready-filter bug: the Ready filter never updates, so newly
// unblocked rows stay hidden.
const filterTar = patch(goodTar, "bad-filter", (src) => {
  const p = join(src, "PlanApp.tsx");
  const s = execFileSync("cat", [p], { encoding: "utf8" });
  const anchor = "  const isReady = (row: Course): boolean =>";
  if (!s.includes(anchor)) throw new Error("filter canary anchor moved; update the script");
  writeFileSync(
    p,
    s.replace(
      anchor,
      "  const isReady = (_row: Course): boolean =>\n    // stale filter: nothing is ever ready\n    false as boolean;\n  const isReadyUnused = (row: Course): boolean =>",
    ),
  );
});

// Notice bug: typing no longer clears the alert, so an old error sticks.
const noticeTar = patch(goodTar, "bad-notice", (src) => {
  const p = join(src, "screen.ts");
  const s = execFileSync("cat", [p], { encoding: "utf8" });
  const anchor =
    "  run: ({ form, noticeCell }, ctx) => {\n    form.set({ title: ctx.input.value });\n    noticeCell.set(undefined);";
  if (!s.includes(anchor)) throw new Error("notice canary anchor moved; update the script");
  writeFileSync(
    p,
    s.replace(
      anchor,
      "  run: ({ form, noticeCell }, ctx) => {\n    form.set({ title: ctx.input.value });\n    void noticeCell;",
    ),
  );
});

const cases = [
  ["good fixture accepts", goodTar, 0, null],
  ["empty starter rejects", emptyTar, 1, null],
  ["long-cycle bug rejects", cycleTar, 1, null],
  ["early-mutation failure rejects", mutationTar, 1, null],
  ["stale-ready-filter bug rejects", filterTar, 1, null],
  ["notice-not-cleared rejects", noticeTar, 1, null],
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
