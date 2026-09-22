// Suite defs for repeatable writer trials. No side effects on import.
// Booking grows over rounds 1-5; stock is one fresh round.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const trialDir = fileURLToPath(new URL(".", import.meta.url));
export const repoDir = resolve(trialDir, "../..");

export const SUITES = {
  booking: {
    rounds: [1, 2, 3, 4, 5],
    // Cumulative: round N stages packets 1..N.
    tasks: [
      "packets/01-book-cancel.md",
      "packets/02-edit.md",
      "packets/03-series.md",
      "packets/04-undo.md",
      "packets/05-rename-series.md",
    ],
    guidelines: ["guidelines.md", "booking-guidelines.md"],
  },
  stock: {
    rounds: [1],
    tasks: ["stock/01-stock-moves.md"],
    guidelines: ["guidelines.md"],
  },
};

const JEV_FROZEN = [
  "lib.mjs",
  "bank.mjs",
  "extract.mjs",
  "calibration.json",
  "package.json",
  "shape.mjs",
];

export const suiteFor = (manifest) => {
  const suite = manifest.suite ?? "booking";
  if (!SUITES[suite]) throw new Error(`Unknown suite: ${suite}`);
  return suite;
};

export const roundsFor = (suite) => {
  if (!SUITES[suite]) throw new Error(`Unknown suite: ${suite}`);
  return [...SUITES[suite].rounds];
};

export const taskRounds = (suite) => roundsFor(suite);

export const taskSourcesFor = (suite, round) => {
  if (!SUITES[suite]) throw new Error(`Unknown suite: ${suite}`);
  if (!SUITES[suite].rounds.includes(round))
    throw new Error(`Suite ${suite} has no round ${round}`);
  if (suite === "booking") return SUITES.booking.tasks.slice(0, round);
  return [...SUITES.stock.tasks];
};

export const guidelineSourcesFor = (suite) => {
  if (!SUITES[suite]) throw new Error(`Unknown suite: ${suite}`);
  return [...SUITES[suite].guidelines];
};

export const sha256Text = (text) => createHash("sha256").update(text).digest("hex");

export const sha256File = (path) => sha256Text(readFileSync(path));

// Full rule text staged into /work/GUIDELINES.md for one suite.
export const assembleGuidelines = (suite) =>
  guidelineSourcesFor(suite)
    .map((file) => readFileSync(join(trialDir, file), "utf8"))
    .join("\n");

// Freeze task, rules, and tool copies for one trial. New trials
// require the shape helper; old trials without frozen/ keep working.
export const freezeTrial = (root, suite) => {
  if (!SUITES[suite]) throw new Error(`Unknown suite: ${suite}`);
  const frozen = join(root, "frozen");
  if (existsSync(frozen)) throw new Error("Frozen copies exist; preserve them, do not refresh");
  const shapePath = join(repoDir, "tools/jev/shape.mjs");
  if (!existsSync(shapePath)) throw new Error("Shape helper required for new trials");
  const files = {};
  const put = (src, dest) => {
    mkdirSync(join(frozen, dest.slice(0, dest.lastIndexOf("/"))), {
      recursive: true,
    });
    copyFileSync(src, join(frozen, dest));
    files[dest] = sha256File(src);
  };
  for (const task of taskSourcesFor(suite, SUITES[suite].rounds.at(-1)))
    put(join(trialDir, task), `tasks/${task.split("/").pop()}`);
  for (const guide of guidelineSourcesFor(suite)) put(join(trialDir, guide), `rules/${guide}`);
  for (const tool of ["extension.mjs", "broker.mjs"]) put(join(trialDir, tool), `tools/${tool}`);
  for (const file of JEV_FROZEN) put(join(repoDir, "tools/jev", file), `jev/${file}`);
  return { dir: "frozen", files };
};

// Staging reads frozen copies only, never the mutable repo.
export const verifyFrozen = (root, frozen) => {
  for (const [rel, hash] of Object.entries(frozen.files)) {
    const path = join(root, frozen.dir, rel);
    if (!existsSync(path)) throw new Error(`Frozen copy missing: ${rel}`);
    if (sha256File(path) !== hash)
      throw new Error(`Frozen copy changed: ${rel}; refusing to stage`);
  }
  return true;
};

const frozenTaskNames = (suite, round) =>
  taskSourcesFor(suite, round).map((task) => `tasks/${task.split("/").pop()}`);

export const readFrozenTask = (root, frozen, suite, round) =>
  frozenTaskNames(suite, round)
    .map((name) => readFileSync(join(root, frozen.dir, name), "utf8"))
    .join("\n\n---\n\n");

export const readFrozenGuidelines = (root, frozen, suite) =>
  guidelineSourcesFor(suite)
    .map((file) => readFileSync(join(root, frozen.dir, `rules/${file}`), "utf8"))
    .join("\n");

export const readFrozenToolPath = (root, frozen, name) => join(root, frozen.dir, `tools/${name}`);

export const listFiles = (dir) => {
  const out = [];
  const walk = (base) => {
    for (const entry of readdirSync(base)) {
      const full = join(base, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full.slice(dir.length + 1));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
};
