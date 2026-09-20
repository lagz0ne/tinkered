// Shared helpers for the Jev advisory layer (ADR: docs/roadmap/jev-loop/PLAN.md).
//
// Jev is TypeSafe's evaluation model: typed probabilistic decisions in/out, no text.
// We use it ONLY as an advisory triage — every script here always exits 0 (or 2 under
// --strict, which is never wired into a gate). The truth stays vp check / tests / mutate /
// SCIP / the human lead. Questions are framed as ANTI-GOALS (safety properties: "is this
// bad thing present?") because a literal model is strong at narrow yes/no and weak at broad,
// multi-hop, numeric, or date judgments.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { experimental_evaluate as evaluate } from "ai";

const MODEL = "typesafe-ai/jev";

/** Load the gateway key into the env without printing it. Prefers AI_GATEWAY_API_KEY;
 *  falls back to a local token file (JEV_TOKEN_FILE, default the pilot path). */
export function loadKey() {
  if (process.env.AI_GATEWAY_API_KEY) return true;
  const file = process.env.JEV_TOKEN_FILE ?? "/home/paseo/pilot/.ai-gateway-token";
  try {
    const token = readFileSync(file, "utf8").trim();
    if (token) {
      process.env.AI_GATEWAY_API_KEY = token;
      return true;
    }
  } catch {
    /* fall through */
  }
  console.error("jev: no key (set AI_GATEWAY_API_KEY or JEV_TOKEN_FILE); skipping — advisory only");
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One evaluate call, with a small courtesy gap and 429 backoff (free tier is rate-capped). */
export async function ask(state, questions, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const { answers } = await evaluate({ model: MODEL, state, questions });
      await sleep(300);
      return answers;
    } catch (e) {
      if (/rate|429/i.test(String(e?.message ?? e))) {
        await sleep(8000 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw new Error("jev: gave up after rate-limit retries");
}

// ---------- git helpers ----------
const git = (args) => execSync(`git ${args}`, { encoding: "utf8" });
export const diff = (range) => git(`diff ${range}`);
export const message = (range) => {
  // last commit in the range; for a worktree range fall back to the staged summary
  try {
    return git(`log -1 --format=%B ${range.split("..").pop() || "HEAD"}`).trim();
  } catch {
    return "";
  }
};
/** Changed source files in a range, excluding tests/config/generated. */
export function changedSources(range) {
  const untracked = range.includes("..") ? "" : git("ls-files --others --exclude-standard");
  return (git(`diff --name-only ${range}`) + "\n" + untracked)
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|\.config\.|\/dist\//.test(f))
    .filter(Boolean);
}
/** A file's content at the new side of the range (working tree if no `..`). */
export function fileAt(range, path) {
  const rhs = range.includes("..") ? range.split("..").pop() : "";
  try {
    return rhs ? git(`show ${rhs}:${path}`) : readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

// ---------- the anti-goal question bank (proven set) ----------
// Each judge is a boolean safety-property. Thresholds start at the values proven on labeled
// cases (2026-09-18): judges separated bad from clean by 59–90%, so 0.5 is safe to start.
export const JUDGES = {
  partialStub: {
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does the code leave required work unfinished — a placeholder body, a thrown not-implemented, or a TODO on the main path?",
      criteria: {
        true: "a required path is stubbed, throws not-implemented, or is marked TODO/FIXME",
        false: "every required path has a real implementation",
      },
    },
  },
  memoKeyIgnoresInput: {
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Is a cached or memoized result stored under a key that omits an input the result depends on, so a later call with a different value returns the earlier cached result?",
      criteria: {
        true: "the key leaves out an input that changes the correct result",
        false: "the key includes every input the result depends on, or there is no caching",
      },
    },
  },
  leakedInternal: {
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        'Does this file expose, through a public or exported API, a symbol whose name or role marks it as internal (helper, impl detail, underscore-prefixed, "internal", "unsafe")?',
      criteria: {
        true: "a public export exposes an internal-looking symbol",
        false: "only intentionally-public symbols cross the public surface",
      },
    },
  },
};

// Route is a CLASSIFIER. Proven weaker (2/3): trust the choice only at/above 0.6, else defer
// to a human; never rely on it for perf (send perf to a structural tool).
export const ROUTE = {
  minConfidence: 0.6,
  q: {
    type: "choice",
    instructions: "If this diff has a problem, which kind is most likely?",
    criteria: {
      correctness: "the logic could produce a wrong result",
      style: "only naming or formatting concerns",
      perf: "an allocation or performance concern in a hot path",
    },
  },
};

export const OVERCLAIM = {
  threshold: 0.6,
  q: {
    type: "boolean",
    instructions:
      "Does the commit message state an outcome the diff does not contain — for example a test, benchmark, or fix that is absent from these changes?",
    criteria: {
      true: "the message asserts a result the diff does not show",
      false: "every claim in the message is backed by a change in the diff",
    },
  },
};

export const pct = (p) => `${(p * 100).toFixed(0)}%`;
