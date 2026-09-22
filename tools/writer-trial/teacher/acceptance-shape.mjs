import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Plain source-shape notes over submitted text. Never imports the code.
// Name-based patterns (hooks, useData/useRun, ScopeProvider, data) are
// review notes: a legal import alias or layout change must not fail
// acceptance. Only exact-syntax rules fail: console/bare throw,
// hidden casts, mocks. Ownership and error handling stay with lead review.

const withoutBlockComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat(m.split("\n").length - 1));

const withoutLineComment = (line) => {
  const cut = line.search(/(^|[^:])\/\//);
  return cut === -1 ? line : line.slice(0, cut === 0 ? 0 : cut + 1);
};

// Comments stripped, strings kept: import paths are strings.
const noComments = (text) => withoutBlockComments(text).split("\n").map(withoutLineComment);

const blankStrings = (line) =>
  line.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');

// Strings blanked too, lines kept: labels and messages cannot trip patterns.
const codeOf = (text) => noComments(text).map(blankStrings);

const walkInto = (out, full, pattern) => {
  if (statSync(full).isDirectory()) return out.concat(walk(full, pattern));
  return pattern.test(full.split("/").pop()) ? out.concat(full) : out;
};

const walk = (dir, pattern) => {
  let out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    out = walkInto(out, join(dir, entry), pattern);
  }
  return out;
};

const hitLines = (full, short, pattern) => {
  const found = [];
  codeOf(readFileSync(full, "utf8")).forEach((line, i) => {
    if (pattern.test(line)) found.push(`${short(full)}:${i + 1}`);
  });
  return found;
};

const hits = (files, short, pattern) => files.flatMap((full) => hitLines(full, short, pattern));

const namedImport = (line) =>
  /import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/.exec(line);

const starImport = (line) => /import\s*\*\s*as\s+([\w$]+)\s*from\s*["']([^"']+)["']/.exec(line);

const defaultImport = (line) =>
  /import\s+([\w$]+)\s*[,{]/.exec(line) ?? /import\s+([\w$]+)\s+from\s*["']([^"']+)["']/.exec(line);

const importSource = (line) => /from\s*["']([^"']+)["']/.exec(line);

const recordNamed = (local, modules, named) => {
  if (!named || !modules.includes(named[2])) return;
  for (const part of named[1].split(",")) {
    const m = /([\w$]+)(?:\s+as\s+([\w$]+))?/.exec(part.trim());
    if (m && local.has(m[1])) local.get(m[1]).add(m[2] ?? m[1]);
  }
};

const recordSpace = (spaces, modules, match) => {
  if (match && modules.includes(match[2])) spaces.push(match[1]);
};

const recordDefault = (spaces, modules, line) => {
  const def = defaultImport(line);
  if (!def) return;
  const from = importSource(line);
  if (from && modules.includes(from[1])) spaces.push(def[1]);
};

const scanImportLine = (local, spaces, modules, line) => {
  recordNamed(local, modules, namedImport(line));
  recordSpace(spaces, modules, starImport(line));
  recordDefault(spaces, modules, line);
};

// Resolve legal import aliases: `import { useData as read } from ...`,
// `import * as TR from ...` plus `TR.useData(`, `import React` plus
// `React.useState(`. Falls back to the plain name when unresolved.
const imported = (files, modules, names) => {
  const local = new Map(names.map((n) => [n, new Set([n])]));
  const spaces = [];
  for (const full of files) {
    for (const line of noComments(readFileSync(full, "utf8"))) {
      scanImportLine(local, spaces, modules, line);
    }
  }
  return { local, spaces };
};

const callNames = (nameSet) => [...nameSet].join("|");

const callSpaces = (spaceList) => (spaceList.length ? spaceList.join("|") : "@@none@@");

const anyCall = (nameSet, spaceList) => {
  const names = callNames(nameSet);
  const spaces = callSpaces(spaceList);
  return new RegExp(
    `(?:\\b(?:${names})\\s*(?:<[^()]*>)?\\s*\\(|(?:${spaces})\\.(?:${names})\\s*(?:<[^()]*>)?\\s*\\()`,
  );
};

const scopePattern = (scopeNames, spaces) => {
  const names = callNames(scopeNames);
  const owned = callSpaces(spaces);
  return new RegExp(
    `(?:\\b(?:${names})\\s*\\(|(?:${owned})\\.(?:${names})\\s*\\(|Scope\\.Handle|\\.controller\\b|Controller<|createSession)`,
  );
};

const providerUsesCreate = (full, providerNames) => {
  const text = readFileSync(full, "utf8");
  const code = codeOf(text).join("\n");
  return providerNames.some((n) => new RegExp(`\\b${n}\\b`).test(code)) && /create\s*=/.test(code);
};

const checkViewPresence = (tsxFiles) => {
  if (!tsxFiles.length) return { fail: "no .tsx view file under src/" };
  return { ok: tsxFiles.join(", ") };
};

const checkNoise = (srcFiles, short) => {
  const noise = hits(srcFiles, short, /\bconsole\.\w+|throw\s+new\s+Error/);
  if (noise.length) return { fail: noise.join(", ") };
  return { ok: "clean" };
};

const checkCasts = (srcFiles, short) => {
  const casts = hits(srcFiles, short, /\bas\s+unknown\b|\bas\s+any\b|:\s*any\b/);
  if (casts.length) return { fail: casts.join(", ") };
  return { ok: "no as unknown/as any/: any" };
};

const checkMocks = (srcFiles, testFiles, short) => {
  const mockHits = hits(
    srcFiles.concat(testFiles),
    short,
    /\bspyOn\b|jest\.mock|vi\.mock|vi\.spyOn|jest\.spyOn|\.mock\(|__mocks__|\.unmock/,
  );
  if (mockHits.length) return { fail: mockHits.join(", ") };
  return { ok: "clean" };
};

const noteHooks = (note, srcFiles, short) => {
  const react = imported(
    srcFiles,
    ["react"],
    ["useState", "useReducer", "useRef", "useEffect", "useLayoutEffect", "useId"],
  );
  const forbiddenHooks = ["useState", "useReducer", "useRef", "useEffect", "useLayoutEffect"];
  const forbiddenNames = new Set(forbiddenHooks.flatMap((n) => [...react.local.get(n)]));
  const hookHits = hits(srcFiles, short, anyCall(forbiddenNames, react.spaces));
  // useId is allowed for unique labels across mounted roots; never flag it.
  note("React local-state hooks?", hookHits.join(", ") || "none found");
};

const noteReads = (note, srcFiles, tsxFiles, short) => {
  const tinker = imported(
    srcFiles,
    ["@tinker/react"],
    ["useData", "useRun", "useScope", "ScopeProvider"],
  );
  const core = imported(srcFiles, ["@tinker/core"], ["data"]);
  const dataHits = hits(srcFiles, short, anyCall(core.local.get("data"), core.spaces));
  note("cell declarations found", dataHits.join(", ") || "none (ownership: lead review)");
  const scopeHits = hits(
    tsxFiles,
    short,
    scopePattern(new Set([...tinker.local.get("useScope")]), tinker.spaces),
  );
  note("scope/session/controller in view?", scopeHits.join(", ") || "none found");
  const reads =
    hits(tsxFiles, short, anyCall(new Set([...tinker.local.get("useData")]), tinker.spaces))
      .length > 0;
  const runs =
    hits(tsxFiles, short, anyCall(new Set([...tinker.local.get("useRun")]), tinker.spaces)).length >
    0;
  note(
    "view reads cells and runs actions",
    `useData: ${reads}, useRun: ${runs} (aliases resolved)`,
  );
  const provider = tsxFiles.some((full) =>
    providerUsesCreate(full, [...tinker.local.get("ScopeProvider")]),
  );
  note(
    "BookingApp owns scope via provider",
    provider ? "ScopeProvider create= found" : "not found (lead review)",
  );
};

const noteErrors = (note, srcFiles, short) => {
  const custom = hits(srcFiles, short, /\bfunction\s+use[A-Z]\w*|const\s+use[A-Z]\w*\s*=/);
  if (custom.length) note("custom hook hides a pattern?", custom.join(", "));
  note(
    "unknown errors must rethrow (lead reviews)",
    `catch: ${hits(srcFiles, short, /\bcatch\b/).length}, rethrow: ${hits(srcFiles, short, /\bthrow\s+(error|caught|e)\b/).length}, isError: ${hits(srcFiles, short, /\bisError\s*\(/).length}`,
  );
};

export function shapeCases(root) {
  const cases = [];
  const advisory = [];
  const fail = (name, error) => cases.push({ name, pass: false, error });
  const ok = (name, detail) => cases.push({ name, pass: true, detail });
  const note = (name, detail) => advisory.push({ name, detail });
  const short = (full) => full.slice(root.length + 1);

  const srcFiles = walk(join(root, "src"), /\.tsx?$/);
  if (!srcFiles.length) {
    fail("shape: src present", "no TypeScript files under src/");
    return { cases, advisory };
  }
  ok("shape: src present", `${srcFiles.length} file(s)`);
  const tsxFiles = srcFiles.filter((f) => f.endsWith(".tsx"));
  const view = checkViewPresence(tsxFiles.map(short));
  if (view.fail) fail("shape: view present", view.fail);
  else ok("shape: view present", view.ok);
  const testFiles = walk(join(root, "tests"), /\.m?[jt]sx?$|\.cjs$/);

  noteHooks(note, srcFiles, short);
  noteReads(note, srcFiles, tsxFiles, short);
  noteErrors(note, srcFiles, short);

  // Exact syntax only: these cannot be hidden behind an alias.
  const noise = checkNoise(srcFiles, short);
  if (noise.fail) fail("shape: no console or bare throw", noise.fail);
  else ok("shape: no console or bare throw", noise.ok);

  const casts = checkCasts(srcFiles, short);
  if (casts.fail) fail("shape: no hidden casts", casts.fail);
  else ok("shape: no hidden casts", casts.ok);

  const mocks = checkMocks(srcFiles, testFiles, short);
  if (mocks.fail) fail("shape: no mocks or spies", mocks.fail);
  else ok("shape: no mocks or spies", mocks.ok);

  return { cases, advisory };
}
