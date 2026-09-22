import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Plain source-shape notes over submitted text. Never imports the code.
// Name-based patterns (hooks, useData/useRun, ScopeProvider, data) are
// review notes: a legal import alias or layout change must not fail
// acceptance. Only exact-syntax rules fail: console/bare throw,
// hidden casts, mocks. Ownership and error handling stay with lead review.
export function shapeCases(root) {
  const cases = [];
  const advisory = [];
  const fail = (name, error) => cases.push({ name, pass: false, error });
  const ok = (name, detail) => cases.push({ name, pass: true, detail });
  const note = (name, detail) => advisory.push({ name, detail });

  const walk = (dir, pattern) => {
    let out = [];
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out = out.concat(walk(full, pattern));
      else if (pattern.test(entry)) out.push(full);
    }
    return out;
  };
  const short = (full) => full.slice(root.length + 1);

  const srcFiles = walk(join(root, "src"), /\.tsx?$/);
  if (!srcFiles.length) {
    fail("shape: src present", "no TypeScript files under src/");
    return { cases, advisory };
  }
  ok("shape: src present", `${srcFiles.length} file(s)`);
  const tsxFiles = srcFiles.filter((f) => f.endsWith(".tsx"));
  if (!tsxFiles.length) fail("shape: view present", "no .tsx view file under src/");
  else ok("shape: view present", tsxFiles.map(short).join(", "));
  const testFiles = walk(join(root, "tests"), /\.m?[jt]sx?$|\.cjs$/);

  // Comments stripped, strings kept: import paths are strings.
  const noComments = (text) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat(m.split("\n").length - 1))
      .split("\n")
      .map((line) => {
        const cut = line.search(/(^|[^:])\/\//);
        return cut === -1 ? line : line.slice(0, cut === 0 ? 0 : cut + 1);
      });
  // Strings blanked too, lines kept: labels and messages cannot trip patterns.
  const codeOf = (text) =>
    noComments(text).map((line) =>
      line.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""'),
    );
  const readLines = (full) => codeOf(readFileSync(full, "utf8"));
  const hits = (files, pattern) => {
    const found = [];
    for (const full of files) {
      readLines(full).forEach((line, i) => {
        if (pattern.test(line)) found.push(`${short(full)}:${i + 1}`);
      });
    }
    return found;
  };

  // Resolve legal import aliases: `import { useData as read } from ...`,
  // `import * as TR from ...` plus `TR.useData(`, `import React` plus
  // `React.useState(`. Falls back to the plain name when unresolved.
  const imported = (files, modules, names) => {
    const local = new Map(names.map((n) => [n, new Set([n])]));
    const spaces = [];
    for (const full of files) {
      for (const line of noComments(readFileSync(full, "utf8"))) {
        const named = /import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/.exec(line);
        if (named && modules.includes(named[2])) {
          for (const part of named[1].split(",")) {
            const m = /([\w$]+)(?:\s+as\s+([\w$]+))?/.exec(part.trim());
            if (m && local.has(m[1])) local.get(m[1]).add(m[2] ?? m[1]);
          }
        }
        const star = /import\s*\*\s*as\s+([\w$]+)\s*from\s*["']([^"']+)["']/.exec(line);
        if (star && modules.includes(star[2])) spaces.push(star[1]);
        const def =
          /import\s+([\w$]+)\s*[,{]/.exec(line) ??
          /import\s+([\w$]+)\s+from\s*["']([^"']+)["']/.exec(line);
        if (def) {
          const from = /from\s*["']([^"']+)["']/.exec(line);
          if (from && modules.includes(from[1])) spaces.push(def[1]);
        }
      }
    }
    return { local, spaces };
  };
  const anyCall = (nameSet, spaceList) =>
    new RegExp(
      `(?:\\b(?:${[...nameSet].join("|")})\\s*(?:<[^()]*>)?\\s*\\(|(?:${spaceList.length ? spaceList.join("|") : "@@none@@"})\\.(?:${[...nameSet].join("|")})\\s*(?:<[^()]*>)?\\s*\\()`,
    );

  const react = imported(
    srcFiles,
    ["react"],
    ["useState", "useReducer", "useRef", "useEffect", "useLayoutEffect", "useId"],
  );
  const forbiddenHooks = ["useState", "useReducer", "useRef", "useEffect", "useLayoutEffect"];
  const forbiddenNames = new Set(forbiddenHooks.flatMap((n) => [...react.local.get(n)]));
  const hookHits = hits(srcFiles, anyCall(forbiddenNames, react.spaces));
  // useId is allowed for unique labels across mounted roots; never flag it.
  if (hookHits.length) note("React local-state hooks?", hookHits.join(", "));
  else note("React local-state hooks?", "none found");

  const tinker = imported(
    srcFiles,
    ["@tinker/react"],
    ["useData", "useRun", "useScope", "ScopeProvider"],
  );
  const core = imported(srcFiles, ["@tinker/core"], ["data"]);
  const dataNames = core.local.get("data");
  const dataHits = hits(srcFiles, anyCall(dataNames, core.spaces));
  note("cell declarations found", dataHits.join(", ") || "none (ownership: lead review)");

  const scopeNames = new Set([...tinker.local.get("useScope")]);
  const scopeHits = hits(
    tsxFiles,
    new RegExp(
      `(?:\\b(?:${[...scopeNames].join("|")})\\s*\\(|(?:${tinker.spaces.length ? tinker.spaces.join("|") : "@@none@@"})\\.(?:${[...scopeNames].join("|")})\\s*\\(|Scope\\.Handle|\\.controller\\b|Controller<|createSession)`,
    ),
  );
  if (scopeHits.length) note("scope/session/controller in view?", scopeHits.join(", "));
  else note("scope/session/controller in view?", "none found");

  const dataRead = new Set([...tinker.local.get("useData")]);
  const runCall = new Set([...tinker.local.get("useRun")]);
  const reads = hits(tsxFiles, anyCall(dataRead, tinker.spaces)).length > 0;
  const runs = hits(tsxFiles, anyCall(runCall, tinker.spaces)).length > 0;
  note(
    "view reads cells and runs actions",
    `useData: ${reads}, useRun: ${runs} (aliases resolved)`,
  );

  const providerNames = [...tinker.local.get("ScopeProvider")];
  const provider = tsxFiles.some((full) => {
    const text = readFileSync(full, "utf8");
    return (
      providerNames.some((n) => new RegExp(`\\b${n}\\b`).test(codeOf(text).join("\n"))) &&
      /create\s*=/.test(codeOf(text).join("\n"))
    );
  });
  note(
    "BookingApp owns scope via provider",
    provider ? "ScopeProvider create= found" : "not found (lead review)",
  );

  const custom = hits(srcFiles, /\bfunction\s+use[A-Z]\w*|const\s+use[A-Z]\w*\s*=/);
  if (custom.length) note("custom hook hides a pattern?", custom.join(", "));
  note(
    "unknown errors must rethrow (lead reviews)",
    `catch: ${hits(srcFiles, /\bcatch\b/).length}, rethrow: ${hits(srcFiles, /\bthrow\s+(error|caught|e)\b/).length}, isError: ${hits(srcFiles, /\bisError\s*\(/).length}`,
  );

  // Exact syntax only: these cannot be hidden behind an alias.
  const noise = hits(srcFiles, /\bconsole\.\w+|throw\s+new\s+Error/);
  if (noise.length) fail("shape: no console or bare throw", noise.join(", "));
  else ok("shape: no console or bare throw", "clean");

  const casts = hits(srcFiles, /\bas\s+unknown\b|\bas\s+any\b|:\s*any\b/);
  if (casts.length) fail("shape: no hidden casts", casts.join(", "));
  else ok("shape: no hidden casts", "no as unknown/as any/: any");

  const mockHits = hits(
    srcFiles.concat(testFiles),
    /\bspyOn\b|jest\.mock|vi\.mock|vi\.spyOn|jest\.spyOn|\.mock\(|__mocks__|\.unmock/,
  );
  if (mockHits.length) fail("shape: no mocks or spies", mockHits.join(", "));
  else ok("shape: no mocks or spies", "clean");

  return { cases, advisory };
}
