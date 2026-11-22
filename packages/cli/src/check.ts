import { globSync, readFileSync } from "node:fs";
import { join, matchesGlob } from "node:path";

import { findBarrel } from "./barrel";
import { raise } from "./errors";
import { appCode } from "./exits";
import { applyGaps } from "./gaps";
import { findLink } from "./link";
import { findPage } from "./page";
import { findPlain } from "./plain";
import type { own } from "./rules";

export declare namespace Check {
  /** A rule id, as the skills name it (ADR 0143 decision 4). */
  type Rule = (typeof own)[number];
  /** One file of the app: its path from the app root, with `/`, and its text. */
  type Source = { path: string; text: string };
  /** One broken rule at one line. `what` names the thing found there. */
  type Finding = { path: string; line: number; rule: Rule; what: string };
  /**
   * Functions that may stay plain, by file and then by name. Each value is the reason: an
   * entry contract runs before any scope exists, so it cannot be an operation.
   */
  type Entries = Readonly<Record<string, Readonly<Record<string, string>>>>;
  /**
   * A graph rule (ADR 0167): each operation that writes a cell `writes` matches must reach
   * `calls` through its calls, directly or through the ops it calls. In `writes`, a `*` part
   * stands for one label part or more. `except` maps an operation to its reason.
   */
  type GraphRule = { writes: string; calls: string; except?: Readonly<Record<string, string>> };
  /** The app's `tinker.json`. Every key may be absent. */
  type Config = {
    plain?: { entries?: Entries };
    /**
     * `files` are the globs of the page's files (default: all of `src/`, less `.server.`
     * files). `skip` takes files out again: a glob, and the reason as its value.
     */
    page?: { files?: readonly string[]; skip?: Readonly<Record<string, string>> };
    /**
     * The app's gaps doc, from the root. A finding marked `// tinker-gap: G<n>` on the line
     * above is allowed while row `G<n>` of that doc is open and within its count.
     */
    gaps?: string;
    /**
     * The command that runs the app's tests, as a shell line. With it, the tests are a stage of
     * the check, and each exit an operation declares must be reached by a test (ADR 0159).
     */
    tests?: string;
    /** The rules the `graph` stage tests the code's graph against (ADR 0167). */
    graph?: { rules?: readonly GraphRule[] };
  };
  /** One row of the gaps doc: its id, whether it is open, its count, and its marked lines. */
  type Gap = { gap: string; open: boolean; lines: number; marked: number };
  /** `files` counts every file read. Findings are in path order, then line order. */
  type Report = { files: number; findings: Finding[]; gaps: Gap[] };
}

/** The app code the plain-function check reads. */
const appFiles = "{src,cmds,tinker}/**/*.{ts,tsx,mts,cts}";

/** A declaration file holds no code. */
const appFile = /(?<!\.d)\.[mc]?tsx?$/;

/** Where a page's files are when the app's config does not say. */
const pageFiles = ["src/**"];

/** A page file by its ending; a `.server.` file never reaches the page. */
const pageFile = /(?<!\.server|\.d)\.[mc]?[jt]sx?$/;

const configName = "tinker.json";

/** The name before ADR 0156: a file by this name alone stops the run with the new name. */
const oldName = "tinker-analyze.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReasons(value: unknown) {
  return isRecord(value) && Object.values(value).every((reason) => typeof reason === "string");
}

function isEntries(value: unknown) {
  return isRecord(value) && Object.values(value).every(isReasons);
}

function isGlobs(value: unknown) {
  return Array.isArray(value) && value.every((glob) => typeof glob === "string");
}

/** A `*` part stands for whole label parts: `issues*` is no pattern. */
function isPattern(value: unknown) {
  return (
    typeof value === "string" &&
    value.split(".").every((part) => part === "*" || (part !== "" && !part.includes("*")))
  );
}

function isRule(value: unknown) {
  if (!isRecord(value) || !isPattern(value.writes) || typeof value.calls !== "string") {
    return false;
  }
  return value.except === undefined || isReasons(value.except);
}

/** Each part of the config: where it is, the test it passes, and what to say when it fails. */
const parts: readonly [keys: readonly string[], ok: (value: unknown) => boolean, why: string][] = [
  [[], isRecord, "the file is not an object"],
  [["plain"], isRecord, "`plain` and `page` are objects"],
  [["page"], isRecord, "`plain` and `page` are objects"],
  [["plain", "entries"], isEntries, "`plain.entries` maps a file to its names and reasons"],
  [["page", "files"], isGlobs, "`page.files` is a list of globs"],
  [["page", "skip"], isReasons, "`page.skip` maps a glob to a reason"],
  [["gaps"], (value) => typeof value === "string", "`gaps` is the path of the gaps doc"],
  [["tests"], (value) => typeof value === "string", "`tests` is the command that runs the tests"],
  [["graph"], isRecord, "`graph` is an object"],
  [
    ["graph", "rules"],
    (value) => Array.isArray(value) && value.every(isRule),
    "`graph.rules` is a list of { writes, calls, except }; a `*` in `writes` is a whole part",
  ],
];

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return raise("BadConfig", { path: configName, reason: "the file is not JSON" });
  }
}

/** The config's one door: the file's JSON becomes a `Check.Config`, or the run stops. */
function readConfig(root: string): Check.Config {
  const config = parse(readFileSync(join(root, configName), "utf8"));

  for (const [keys, ok, reason] of parts) {
    const value = keys.reduce((at, key) => (isRecord(at) ? at[key] : undefined), config);
    if (keys.length && value === undefined) continue;
    if (!ok(value)) raise("BadConfig", { path: configName, reason });
  }
  return config as Check.Config;
}

function configOf(root: string): Check.Config {
  if (globSync(configName, { cwd: root }).length) return readConfig(root);
  if (globSync(oldName, { cwd: root }).length) {
    raise("BadConfig", { path: oldName, reason: `rename this file to ${configName}` });
  }
  return {};
}

/** The files a glob names that `keep` accepts: a glob may also name a folder. */
function sourcesOf(root: string, pattern: string, keep: RegExp): Check.Source[] {
  return globSync(pattern, { cwd: root })
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => keep.test(path) && !path.includes("node_modules/"))
    .map((path) => ({ path, text: readFileSync(join(root, path), "utf8") }));
}

function pageSources(root: string, { files = pageFiles, skip = {} }: Check.Config["page"] & {}) {
  const skips = Object.keys(skip);
  const paths = new Map<string, Check.Source>();

  for (const source of files.flatMap((glob) => sourcesOf(root, glob, pageFile))) {
    if (skips.some((glob) => matchesGlob(source.path, glob))) continue;
    paths.set(source.path, source);
  }
  return [...paths.values()];
}

/** The gaps doc the config names; a missing doc stops the run like a bad config. */
function gapsDoc(root: string, path: string): Check.Source {
  if (!globSync(path, { cwd: root }).length) {
    return raise("BadConfig", { path: configName, reason: `the gaps doc ${path} does not exist` });
  }
  return { path, text: readFileSync(join(root, path), "utf8") };
}

/**
 * The app's files and what Tinker's rules find in them, before the gap rule allows any. `doc`
 * is the gaps doc, when the config names one.
 *
 * @throws `BadConfig` when `tinker.json` is not the shape `Check.Config` names.
 */
export function readApp(root: string) {
  const config = configOf(root);
  const app = sourcesOf(root, appFiles, appFile);
  const page = pageSources(root, config.page ?? {});

  const found = [
    ...findPlain(app, config.plain?.entries ?? {}),
    ...page.flatMap(findPage),
    ...page.filter(({ path }) => path.endsWith("x")).flatMap(findLink),
    ...app.filter(({ path }) => appCode.test(path)).flatMap(findBarrel),
  ];
  const sources = [...new Map([...app, ...page].map((source) => [source.path, source])).values()];
  return {
    sources,
    found,
    ...(config.gaps ? { doc: gapsDoc(root, config.gaps) } : {}),
    ...(config.tests ? { tests: config.tests } : {}),
    rules: config.graph?.rules ?? [],
  };
}

/**
 * Read the app at `root` and answer every broken rule. It reads files and nothing else: it
 * runs no app code. A `tinker.json` at the root holds the app's own exceptions.
 *
 * @throws `BadConfig` when that file is not the shape `Check.Config` names.
 */
export function check(root: string): Check.Report {
  const { sources, found, doc } = readApp(root);
  const { findings, gaps } = doc ? applyGaps(found, sources, doc) : { findings: found, gaps: [] };

  findings.sort(
    (a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.rule.localeCompare(b.rule),
  );
  return { files: sources.length, findings, gaps };
}
