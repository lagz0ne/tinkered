// Suite defs for repeatable writer trials. No side effects on import.
// Booking grows over rounds 1-5; stock, plan, loans, ballot, kitchen, locker, and cinema are one
// fresh round each.
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
  plan: {
    rounds: [1],
    tasks: ["plan/01-learning-plan.md"],
    guidelines: ["guidelines.md"],
  },
  loans: {
    rounds: [1],
    tasks: ["loans/01-tool-library.md"],
    guidelines: ["guidelines.md"],
  },
  ballot: {
    rounds: [1],
    tasks: ["ballot/01-team-poll.md"],
    guidelines: ["guidelines.md"],
  },
  kitchen: {
    rounds: [1],
    tasks: ["kitchen/01-kitchen-queue.md"],
    guidelines: ["guidelines.md"],
  },
  locker: {
    rounds: [1],
    tasks: ["locker/01-parcel-locker.md"],
    guidelines: ["guidelines.md"],
  },
  cinema: {
    rounds: [1],
    tasks: ["cinema/01-seat-map.md"],
    guidelines: ["guidelines.md"],
  },
};

// Worker extension tools: extension.mjs is staged as index.mjs.
export const TRIAL_TOOLS = ["extension.mjs", "broker.mjs", "gate.mjs"];

const JEV_FROZEN = [
  "lib.mjs",
  "bank.mjs",
  "extract.mjs",
  "calibration.json",
  "package.json",
  "shape.mjs",
  "plain.mjs",
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

// A fresh-round suite stages one task file, named as its frozen source.
export const taskFileFor = (suite, round) => {
  if (suite !== "booking" && SUITES[suite]) {
    if (round !== 1) throw new Error(`Suite ${suite} has no round ${round}`);
    return SUITES[suite].tasks[0].split("/").pop();
  }
  if (!SUITES[suite]) throw new Error(`Unknown suite: ${suite}`);
  const names = {
    1: "01-book-cancel.md",
    2: "02-edit.md",
    3: "03-series.md",
    4: "04-undo.md",
    5: "05-rename-series.md",
  };
  if (!names[round]) throw new Error(`Suite ${suite} has no round ${round}`);
  return names[round];
};

export const taskSourcesFor = (suite, round) => {
  if (!SUITES[suite]) throw new Error(`Unknown suite: ${suite}`);
  if (!SUITES[suite].rounds.includes(round))
    throw new Error(`Suite ${suite} has no round ${round}`);
  if (suite === "booking") return SUITES.booking.tasks.slice(0, round);
  return [...SUITES[suite].tasks];
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
  for (const tool of TRIAL_TOOLS) put(join(trialDir, tool), `tools/${tool}`);
  // Limits drift after create when stage reads live config.
  // New trials freeze config.json and read limits from the copy.
  put(join(trialDir, "config.json"), "config.json");
  for (const file of JEV_FROZEN) put(join(repoDir, "tools/jev", file), `jev/${file}`);
  return { dir: "frozen", files };
};

export const frozenConfigFor = (root, frozen) =>
  JSON.parse(readFileSync(join(root, frozen.dir, "config.json"), "utf8"));

// New trials read limits from the frozen copy; old trials use live config.
// Fixture dirs work here: no repo config edit is needed to test this.
export const limitsFor = (manifest, liveConfig, root) => {
  if (manifest.frozen) return frozenConfigFor(root, manifest.frozen).limits;
  return liveConfig.limits;
};

// Old trials without frozen/ keep rounds 1-4; frozen trials use suite rounds.
export const validRounds = (manifest) =>
  manifest.frozen ? roundsFor(suiteFor(manifest)) : [1, 2, 3, 4];
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

// Copy the worker extension tools from one folder (a frozen tools/
// copy or this checkout) into a worker's extension folder. The
// broker imports gate.mjs; trials frozen before the gate have
// neither the import nor the file, so its absence is skipped.
export const copyTrialTools = (fromDir, ext) => {
  for (const tool of TRIAL_TOOLS) {
    const src = join(fromDir, tool);
    if (tool === "gate.mjs" && !existsSync(src)) continue;
    copyFileSync(src, join(ext, tool === "extension.mjs" ? "index.mjs" : tool));
  }
};

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
