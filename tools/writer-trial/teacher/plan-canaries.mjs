// Reproducible canary proofs for the plan checker.
// Builds every proof tar from the teacher-only fixture, runs the isolated
// runner in Docker, and prints one line per proof. No worker code involved.
// Usage: node tools/writer-trial/teacher/plan-canaries.mjs
// Proof tars land in an owned /tmp/plan-canaries-<unique> dir and are
// rebuilt on every run; only the printed case lines and exit codes are
// the evidence (root saves them).
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
const work = join(tmpdir(), `plan-canaries-${randomUUID()}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "proof", "tests"), { recursive: true });

const fixture = join(here, "plan-fixture");
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
  let out = "";
  try {
    out = execFileSync("node", [join(repo, "tools/writer-trial/plan-acceptance.mjs"), tar, IMAGE], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 330000,
    });
    const line = out.split("\n").find((l) => l.startsWith("ACCEPTANCE"));
    const jsonLine = out.split("\n").find((l) => l.startsWith("RESULTS_JSON"));
    return { exit: 0, line, out, json: jsonLine ?? "" };
  } catch (error) {
    out = `${error.stdout ?? ""}`;
    const line = out.split("\n").find((l) => l.startsWith("ACCEPTANCE"));
    const jsonLine = out.split("\n").find((l) => l.startsWith("RESULTS_JSON"));
    const fails = out.split("\n").filter((l) => l.startsWith("FAIL"));
    return { exit: error.status ?? 1, line, fails, out, json: jsonLine ?? "" };
  }
};

// Strict proof: exit code alone cannot pass. A canary passes only with
// structured RESULTS_JSON, no load/boot failure, and the exact intended
// behavioral failures named below. A compile error or timeout names
// load-failed cases instead, so it fails this check honestly.
const casesOf = (r) => {
  const raw = (r.json ?? "").replace(/^RESULTS_JSON\s*/, "");
  if (raw === "") throw new Error("missing RESULTS_JSON");
  return JSON.parse(raw).cases;
};
const failedNames = (r) =>
  casesOf(r)
    .filter((c) => !c.pass)
    .map((c) => c.name);
const loadFailed = (r) =>
  failedNames(r).filter((n) =>
    (casesOf(r).find((c) => c.name === n)?.error ?? "").includes("load failed"),
  );
const failSet = (r) => new Set(failedNames(r));
const missingFails = (r, want) => (want.mustFail ?? []).filter((n) => !failSet(r).has(n));
const wrongPasses = (r, want) => (want.mustPass ?? []).filter((n) => failSet(r).has(n));
const checkNames = (r, want) => {
  if (want.allowLoadFail !== true && loadFailed(r).length > 0)
    return `load/boot failure, not a behavioral proof: ${loadFailed(r).join(", ")}`;
  const missing = missingFails(r, want);
  if (missing.length > 0) return `want failure ${missing.join(", ")}`;
  const wrong = wrongPasses(r, want);
  if (wrong.length > 0) return `want pass ${wrong.join(", ")}, but it failed`;
  return null;
};
const checkResult = (r, want) => {
  if (r.exit !== want.exit) return `want exit ${want.exit}, got ${r.exit}`;
  if (want.fullpass !== undefined) {
    if (r.line !== want.fullpass) return `want ${want.fullpass}, got ${r.line ?? "(no summary)"}`;
  }
  return checkNames(r, want);
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

// Long-cycle bug: direct back-links are still refused, but a three-course
// cycle slips through. Only the long-cycle case may fail.
const cycleTar = patch(goodTar, "bad-cycle", (src) => {
  const p = join(src, "model.ts");
  const s = execFileSync("cat", [p], { encoding: "utf8" });
  const anchor = "    if (reaches(rows, prerequisiteId, courseId))";
  if (!s.includes(anchor)) throw new Error("cycle canary anchor moved; update the script");
  writeFileSync(
    p,
    s.replace(
      anchor,
      "    if (rows.some((row) => row.id === prerequisiteId && row.prerequisiteIds.includes(courseId)))",
    ),
  );
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
  const p = join(src, "model.ts");
  const s = execFileSync("cat", [p], { encoding: "utf8" });
  const anchor = "export const isReady = (rows: readonly Course[], row: Course): boolean =>";
  if (!s.includes(anchor)) throw new Error("filter canary anchor moved; update the script");
  const stale = [
    "export const isReady = (_rows: readonly Course[], _row: Course): boolean => false;",
    "export const isReadyUnused = (rows: readonly Course[], row: Course): boolean =>",
  ].join("\n");
  writeFileSync(p, s.replace(anchor, stale));
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
  ...LAYOUT_NAMES.map((name) => ({
    label: `good layout ${name} accepts`,
    tar: layoutTar(name),
    want: { exit: 0, fullpass: "ACCEPTANCE plan: 43/43 pass" },
  })),
  {
    label: "empty starter rejects",
    tar: emptyTar,
    want: { exit: 1, allowLoadFail: true, mustFail: ["shape: src present"] },
  },
  {
    label: "long-cycle bug rejects",
    tar: cycleTar,
    want: {
      exit: 1,
      mustFail: ["core long cycle fails with unchanged snapshot and history"],
      mustPass: ["core direct cycle fails with unchanged snapshot"],
    },
  },
  {
    label: "early-mutation failure rejects",
    tar: mutationTar,
    want: {
      exit: 1,
      mustFail: ["core failed link keeps courses and history atomic"],
    },
  },
  {
    label: "stale-ready-filter bug rejects",
    tar: filterTar,
    want: {
      exit: 1,
      mustFail: ["browser ready and done filters respond live"],
    },
  },
  {
    label: "notice-not-cleared rejects",
    tar: noticeTar,
    want: {
      exit: 1,
      mustFail: ["browser notices clear on typing, passing create, real no-op"],
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
  const ok = problem === null;
  if (!ok) failed++;
  console.log(
    `${ok ? "CANARY-PASS" : "CANARY-FAIL"} ${label} — exit ${r.exit} — ${r.line ?? "(no summary)"} — ${tar}${ok ? "" : ` — ${problem}`}`,
  );
  if (!ok && r.fails) for (const f of r.fails) console.log(`    ${f}`);
}
process.exitCode = failed ? 1 : 0;
