import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, expect, test } from "vite-plus/test";

import { main } from "@/index";

/** This package's folder: an app links its `node_modules`, so it has `tsc`, `vp` and Core. */
const at = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

const configs = {
  "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
  "tsconfig.json": JSON.stringify({
    extends: at("base/tsconfig.json"),
    compilerOptions: { target: "esnext", module: "esnext", moduleResolution: "bundler" },
    include: ["src"],
  }),
  "vite.config.ts": [
    `import { defineConfig } from "vite-plus";`,
    ``,
    `import { gates } from "${at("src/config.ts")}";`,
    ``,
    `export default defineConfig({`,
    `  lint: {`,
    `    ignorePatterns: ["node_modules/**"],`,
    `    options: { typeAware: true },`,
    `    overrides: [{ files: ["src/**"], rules: gates }],`,
    `  },`,
    `});`,
  ].join("\n"),
  "tinker.json": JSON.stringify({
    plain: {
      entries: {
        "src/routes.ts": {
          loader: "The router calls it before a scope runs.",
          watch: "A stand-in: an object's own watch.",
        },
      },
    },
  }),
};

/**
 * A mail feature: a remote board, a local count, a keyed resource on a part, and the watches
 * Core's own units hold: an operation's, a resource factory's, and a capsule start hook's.
 */
const mail = [
  `import { capsule, data, operation, remoteData, resource, tag } from "@tinkered/core";`,
  ``,
  `type Mail = { box: string; id: string };`,
  ``,
  `export const messages = data({`,
  `  label: "mail.messages",`,
  `  mode: "keyed",`,
  `  key: (m: Mail) => ({ box: m.box, id: m.id }),`,
  `});`,
  `export const board = remoteData({ messages });`,
  `export const unread = data({ label: "mail.unread", initial: 0 });`,
  `const box = tag<string>({ label: "mail.box" });`,
  ``,
  `export const inbox = resource({`,
  `  label: "mail.inbox",`,
  `  config: { box: box.required },`,
  `  depends: (c) => ({ rows: board.messages.where({ box: c.box }) }),`,
  `  factory: ({ rows }) => rows.get(),`,
  `});`,
  ``,
  `export const peek = operation({`,
  `  label: "mail.peek",`,
  `  depends: { count: unread.controller },`,
  `  run: ({ count }) => {`,
  `    count.watch(() => undefined)();`,
  `    return count.get();`,
  `  },`,
  `});`,
  ``,
  `const held = resource({`,
  `  label: "mail.held",`,
  `  depends: { inbox: inbox({ box: "inbox" }) },`,
  `  factory: ({ inbox }, { defer }) => {`,
  `    defer(inbox.watch(() => undefined));`,
  `    return true;`,
  `  },`,
  `});`,
  ``,
  `export const warm = capsule({`,
  `  label: "mail.warm",`,
  `  exports: { held },`,
  `  hooks: {`,
  `    async start({ next, load }) {`,
  `      const meta = { role: "worker", explain: "Counts the unread mail" } as const;`,
  `      const stop = load(unread, meta).watch(() => undefined);`,
  `      const done = await next();`,
  `      stop();`,
  `      return done;`,
  `    },`,
  `  },`,
  `});`,
].join("\n");

/**
 * A route loader that waits on reads with its own watches, outside any unit (#83): a remote
 * part, a keyed resource read, a part of a local cell, and a part held in a `let`. Its own
 * object's `watch` is not Core's.
 */
const routes = [
  `import type { Scope } from "@tinkered/core";`,
  ``,
  `import { board, inbox, messages } from "./mail";`,
  ``,
  `export const loader = (scope: Scope.Handle) => {`,
  `  const part = board.messages.where({ box: "inbox" });`,
  `  const rows = scope.resolve(part);`,
  `  const stop = rows.watch(() => undefined);`,
  `  scope.resolve(inbox({ box: "a" })).watch(() => undefined)();`,
  `  scope.resolve(messages.where({ box: "a" })).watch(() => undefined)();`,
  `  let moved = board.messages.where({ box: "b" });`,
  `  moved = board.messages.where({ box: "c" });`,
  `  scope.resolve(moved).watch(() => undefined)();`,
  `  const own = { watch: (stop: () => void) => stop };`,
  `  own.watch(stop)();`,
  `};`,
].join("\n");

/** An app with these files, its `tinker.graph` written as the code is. */
function appOf(files: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), "tinker-loose-watch-"));
  folders.push(folder);
  symlinkSync(at("node_modules"), join(folder, "node_modules"));

  mkdirSync(join(folder, "src"));
  for (const [path, text] of Object.entries({ ...configs, ...files })) {
    writeFileSync(join(folder, path), text);
  }
  main(["graph", folder, "--write"], "/");
  return folder;
}

/** The head of each finding: path, line, rule id and what is there. */
const findings = (out: string) => out.split("\n").filter((line) => /^\S+:\d+ /.test(line));

test("a watch in a resource factory or a capsule hook is no finding", { timeout: 60_000 }, () => {
  const folder = appOf({ "src/mail.ts": mail });

  const { code, out } = main(["check", folder], "/");

  expect(out).toContain("tinker check: OK\n");
  expect(code).toBe(0);
});

test(
  "a watch outside a unit is a finding; on a remoteData part its fix is the prefetch recipe",
  { timeout: 60_000 },
  () => {
    const folder = appOf({ "src/mail.ts": mail, "src/routes.ts": routes });

    const { code, out } = main(["check", folder], "/");

    expect(code).toBe(1);
    expect(findings(out)).toEqual([
      "src/routes.ts:8 tinker/loose-watch `remoteData` part `board.messages`: " +
        "watched outside an operation, resource or capsule",
      "src/routes.ts:9 tinker/loose-watch `watch` outside an operation, resource or capsule",
      "src/routes.ts:10 tinker/loose-watch `watch` outside an operation, resource or capsule",
      "src/routes.ts:13 tinker/loose-watch `watch` outside an operation, resource or capsule",
    ]);
    expect(out).toContain("  more: tinker skill load @tinkered/core#core/data\n");
    expect(out).toContain("  more: tinker skill load @tinkered/core#core/capsule\n");
    expect(out).toContain("\ntinker check: graph failed.\n");
  },
);

test(
  "a watch on a part written in place in the resolve is a remoteData finding",
  {
    timeout: 60_000,
  },
  () => {
    const inline = routes
      .replace(`  const part = board.messages.where({ box: "inbox" });\n`, "")
      .replace("scope.resolve(part)", `scope.resolve(board.messages.of({ box: "a", id: "b" }))`);
    const folder = appOf({ "src/mail.ts": mail, "src/routes.ts": inline });

    const { out } = main(["check", folder], "/");

    expect(findings(out)[0]).toBe(
      "src/routes.ts:7 tinker/loose-watch `remoteData` part `board.messages`: " +
        "watched outside an operation, resource or capsule",
    );
  },
);
