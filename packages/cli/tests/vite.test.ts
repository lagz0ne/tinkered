import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { build } from "vite-plus";
import { afterAll, expect, test } from "vite-plus/test";

import { pageGuard } from "@/vite";

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** A page app: `index.html` loads `src/main.ts`, and these files sit beside it. */
function pageOf(files: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), "tinker-guard-"));
  folders.push(folder);
  const all = { "index.html": '<script type="module" src="./src/main.ts"></script>\n', ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }

  return folder;
}

/**
 * Build the app with the guard: the page, or the server when `ssr` names its entry. Answer the
 * build error text, or undefined when it builds.
 */
async function buildPage(files: Record<string, string>, ssr?: string) {
  try {
    const root = pageOf(files);
    await build({ root, logLevel: "silent", plugins: [pageGuard()], build: { ssr } });
    return undefined;
  } catch (error) {
    return String(error);
  }
}

const server = `import { readFileSync } from "node:fs";\nexport const read = () => readFileSync("x");\n`;

test("a server file reached through a two-hop barrel stops the build at the barrel", async () => {
  const error = await buildPage({
    "src/main.ts": `import { read } from "./todo";\nconsole.log(read);\n`,
    "src/todo/index.ts": `export * from "./barrel";\n`,
    "src/todo/barrel.ts": `export * from "./db.server";\n`,
    "src/todo/db.server.ts": server,
  });

  expect(error).toContain(`page imports server code "./db.server" from src/todo/barrel.ts`);
});

test("a direct import of a server file stops the build", async () => {
  const error = await buildPage({
    "src/main.ts": `import { read } from "./db.server.mjs";\nconsole.log(read);\n`,
    "src/db.server.mjs": server,
  });

  expect(error).toContain(`page imports server code "./db.server.mjs" from src/main.ts`);
});

test("a server build is not guarded: it may import server code", async () => {
  const error = await buildPage(
    {
      "src/main.ts": `import { read } from "./db.server";\nconsole.log(read);\n`,
      "src/db.server.ts": server,
    },
    "src/main.ts",
  );

  expect(error).toBeUndefined();
});

test("a runtime or backend package name stops the build", async () => {
  const names = [
    "node:fs",
    "bun:sqlite",
    "@tinkered/entry",
    "@tinkered/entry/server",
    "@tinkered/bun",
    "@tinkered/bun/sql",
  ];

  const errors = await Promise.all(
    names.map((name) =>
      buildPage({ "src/main.ts": `import * as m from "${name}";\nconsole.log(m);\n` }),
    ),
  );

  expect(errors.map((error) => error?.match(/page imports server code "[^"]+"/)?.[0])).toEqual(
    names.map((name) => `page imports server code "${name}"`),
  );
});

test("the client entry of @tinkered/bun builds", async () => {
  const error = await buildPage({
    "src/main.ts": `import { connect } from "@tinkered/bun/client";\nconsole.log(connect);\n`,
    "node_modules/@tinkered/bun/package.json": JSON.stringify({
      name: "@tinkered/bun",
      type: "module",
      exports: { "./client": "./client.js", "./sql": "./sql.js" },
    }),
    "node_modules/@tinkered/bun/client.js": `export const connect = () => "page";\n`,
  });

  expect(error).toBeUndefined();
});

test("a page that takes only types from a server file builds", async () => {
  const error = await buildPage({
    "src/main.ts": `import type { Row } from "./db.server";\nconst row: Row = { id: 1 };\nconsole.log(row);\n`,
    "src/db.server.ts": `${server}export type Row = { id: number };\n`,
  });

  expect(error).toBeUndefined();
});

test("a page with no server import builds", async () => {
  const error = await buildPage({
    "src/main.ts": `import { title } from "./title";\nconsole.log(title);\n`,
    "src/title.ts": `export const title = "Todos";\n`,
  });

  expect(error).toBeUndefined();
});
