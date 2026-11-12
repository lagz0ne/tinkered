import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, expect, test } from "vite-plus/test";

import { main } from "@/index";

const folders: string[] = [];

/** The exceptions a fresh template has: its entry contracts, each with a reason. */
const config = {
  plain: {
    entries: {
      "src/frontend/ui/classes.ts": { cn: "shadcn's registry imports it by this name." },
      "tinker/base/main.ts": { defineMain: "Type only." },
      "tinker/base/main-host.ts": { createMainHost: "No scope yet.", runMain: "No scope yet." },
      "tinker/components/rpc/index.ts": { rpc: "Runs at module load." },
      "tinker/components/ws/index.ts": { createWs: "Runs at module load." },
    },
  },
};

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** Run the command on a fresh app folder that holds only these files and that config. */
function checkFiles(files: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), "analyze-plain-"));
  folders.push(folder);
  const all = { "tinker-analyze.json": JSON.stringify(config), ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }

  const result = main(["check", folder], "/");
  return { ...result, hits: result.err.split("\n\n")[0] };
}

const hit = (path: string, line: number) => `${path}:${line} tinker/plain a plain function`;

test("a plain helper fails", () => {
  const result = checkFiles({
    "src/api/greet.ts": `export function shout(s: string) {\n  return s + "!";\n}\n`,
    "tinker/util.ts": `export const twice = (n: number) => n * 2;\n`,
  });

  expect(result.code).toBe(1);
  expect(result.err).toContain(hit("src/api/greet.ts", 1));
  expect(result.err).toContain(hit("tinker/util.ts", 1));
});

test("an IIFE and an object of helpers fail", () => {
  const result = checkFiles({
    "src/a.ts": `export const value = (() => 1)();\n`,
    "src/b.ts": `export const util = Object.freeze({\n  shout(s: string) {\n    return s;\n  },\n});\n`,
  });

  expect(result.code).toBe(1);
  expect(result.err).toContain(hit("src/a.ts", 1));
  expect(result.err).toContain(hit("src/b.ts", 2));
});

test("an operation passes, with its inline callbacks", () => {
  const result = checkFiles({
    "src/api/greet.ts": `import { operation } from "@tinkered/core";

export const shout = operation({
  label: "shout",
  input: (raw: unknown) => String(raw),
  run: (_deps, { input }) => [input].map((s) => s + "!").join(""),
});
`,
  });

  expect(result).toMatchObject({ code: 0, out: "no findings in 1 files\n", err: "" });
});

test("a resource's returned methods pass; a helper only called inside it fails", () => {
  const result = checkFiles({
    "tinker/counter.ts": `import { resource } from "@tinkered/core";

export const counter = resource({
  label: "counter",
  factory: (_deps, ctx) => {
    let count = 0;
    const reset = () => (count = 0);
    ctx.defer(reset);
    const double = (n: number) => n * 2;
    const owned = { add: () => double(++count), read: () => count };
    return owned;
  },
});
`,
  });

  expect(result.code).toBe(1);
  expect(result.hits).toBe(hit("tinker/counter.ts", 9));
});

test("capsule hooks pass; a non-hook in hooks fails", () => {
  const result = checkFiles({
    "tinker/c.ts": `import { capsule } from "@tinkered/core";
import type { Capsule } from "@tinkered/core";

export const shared: Capsule.Hooks = {
  async close({ next }) {
    return next();
  },
};

export const c = capsule({
  label: "c",
  hooks: {
    run({ next }) {
      return next();
    },
    helper() {
      return 1;
    },
  },
});
`,
  });

  expect(result.code).toBe(1);
  expect(result.hits).toBe(hit("tinker/c.ts", 16));
});

test("a function returned from a start hook passes", () => {
  const result = checkFiles({
    "tinker/rpc.ts": `import { capsule } from "@tinkered/core";

export const rpc = capsule({
  label: "rpc",
  hooks: {
    start({ next }) {
      return next().then(() => fetch);

      async function fetch(request: Request) {
        return new Response(request.url);
      }
    },
  },
});
`,
    "tinker/routes.ts": `import { capsule } from "@tinkered/core";

export const routes = capsule({
  label: "routes",
  hooks: {
    async start() {
      return async function fetch(request: Request) {
        return Response.json({ url: request.url });
      };
    },
  },
});
`,
  });

  expect(result).toMatchObject({ code: 0, err: "" });
});

test("cn and defineMain pass as entries, and defineMain takes the command's main", () => {
  const result = checkFiles({
    "src/frontend/ui/classes.ts": `export function cn(...names: string[]) {\n  return names.join(" ");\n}\n`,
    "tinker/base/main.ts": `export const defineMain = <R>(main: () => Promise<R>) => main;\n`,
    "cmds/server.ts": `import { defineMain } from "~/base/main";\n\nexport default defineMain(async () => ({ closed: Promise.resolve() }));\n`,
  });

  expect(result).toMatchObject({ code: 0, err: "" });
});

test("defineMain outside tinker/base/main.ts fails", () => {
  const result = checkFiles({
    "src/main.ts": `export const defineMain = <R>(main: () => Promise<R>) => main;\n`,
  });

  expect(result.code).toBe(1);
  expect(result.hits).toBe(hit("src/main.ts", 1));
});

test("a plain helper beside createMainHost in main-host.ts still fails", () => {
  const result = checkFiles({
    "tinker/base/main-host.ts": `export function createMainHost() {}\n\nexport const shout = (s: string) => s + "!";\n`,
  });

  expect(result.code).toBe(1);
  expect(result.hits).toBe(hit("tinker/base/main-host.ts", 3));
});

test("a third exported function name in main-host.ts is not exempt", () => {
  const result = checkFiles({
    "tinker/base/main-host.ts": `export function createMainHost() {}\n\nexport function runMain() {}\n\nexport function runOther() {}\n`,
  });

  expect(result.code).toBe(1);
  expect(result.hits).toBe(hit("tinker/base/main-host.ts", 5));
});

test("createMainHost and runMain are exempt only in tinker/base/main-host.ts", () => {
  const result = checkFiles({
    "tinker/base/host.ts": `export function createMainHost() {}\n\nexport function runMain() {}\n`,
  });

  expect(result.code).toBe(1);
  expect(result.err).toContain(hit("tinker/base/host.ts", 1));
  expect(result.err).toContain(hit("tinker/base/host.ts", 3));
});

test("a definition maker is exempt only in its own file; a helper beside it still fails", () => {
  const result = checkFiles({
    "tinker/components/rpc/index.ts": `export function rpc() {}\n\nexport const shout = (s: string) => s;\n`,
    "tinker/components/ws/index.ts": `export function createWs() {}\n`,
    "tinker/components/memory/index.ts": `export function createWs() {}\n`,
  });

  expect(result.code).toBe(1);
  expect(result.hits.split("\n")).toEqual([
    hit("tinker/components/memory/index.ts", 1),
    hit("tinker/components/rpc/index.ts", 3),
  ]);
});

test("a function frozen or put in an array at the top level fails", () => {
  const result = checkFiles({
    "src/a.ts": "export const shout = Object.freeze((s: string) => `${s}!`);\n",
    "src/b.ts": `export const [whisper] = [(s: string) => s.toLowerCase()];\n`,
    "src/c.ts": `export const names = Object.entries({ a: 1 }).map(([name]) => name);\n`,
  });

  expect(result.code).toBe(1);
  expect(result.err).toContain(hit("src/a.ts", 1));
  expect(result.err).toContain(hit("src/b.ts", 1));
  expect(result.err).toContain(hit("src/c.ts", 1));
});

test("a callback of a library value passes, here or through an app import", () => {
  const result = checkFiles({
    "tinker/schema.ts": `import { z } from "zod";\n\nexport const batch = z.object({ n: z.number() });\n`,
    "tinker/strict.ts": `import { batch } from "./schema";\n\nexport const small = batch.refine((b) => b.n < 9);\n`,
    "cmds/host.ts": `export const names = [...new Bun.Glob("*").scanSync(".")].filter((n) => n !== "x");\n`,
  });

  expect(result).toMatchObject({ code: 0, err: "" });
});

test("a helper in an .mts or .cts file fails; a .d.mts file is skipped", () => {
  const result = checkFiles({
    "src/util.mts": `export const loud = (s: string) => s.toUpperCase();\n`,
    "tinker/util.cts": `export function quiet(s: string) {\n  return s;\n}\n`,
    "src/types.d.mts": `export function typed(s: string) {\n  return s;\n}\n`,
  });

  expect(result.code).toBe(1);
  expect(result.err).toContain(hit("src/util.mts", 1));
  expect(result.err).toContain(hit("tinker/util.cts", 1));
  expect(result.err).not.toContain("types.d.mts");
});

test("Bun.serve's fetch and error pass", () => {
  const result = checkFiles({
    "cmds/host.ts": `Bun.serve({
  fetch(request) {
    return new Response(request.url);
  },
  error: () => new Response(null, { status: 500 }),
  routes: { "/api/*": async () => new Response("ok") },
});
`,
  });

  expect(result).toMatchObject({ code: 0, err: "" });
});

test("a React component passes", () => {
  const result = checkFiles({
    "src/page.tsx": `export function Greeting({ name }: { name: string }) {\n  return <p>{name}</p>;\n}\n`,
  });

  expect(result).toMatchObject({ code: 0, err: "" });
});

test("a top-level function handed to an event registration fails; written inline it passes", () => {
  const result = checkFiles({
    "cmds/browser.ts": `const close = () => console.log("closed");\nwindow.addEventListener("pagehide", close);\n`,
    "cmds/inline.ts": `window.addEventListener("pagehide", () => console.log("closed"));\n`,
    "src/ui/classes.ts": `export function cn(...names: string[]) {\n  return names.join(" ");\n}\n`,
  });

  expect(result.code).toBe(1);
  expect(result.hits).toBe([hit("cmds/browser.ts", 1), hit("src/ui/classes.ts", 1)].join("\n"));
});

/** A module resource: Core loads the package, and functions reach it through `depends`. */
const authModules = `import { resource } from "@tinkered/core";

export const authModule = resource({
  label: "module:better-auth",
  factory: () => import("better-auth"),
});
`;

/** Better Auth's shape: destructure the module, call it with nested option callbacks. */
const authFile = `import { operation, resource } from "@tinkered/core";

import { authModule } from "./modules";

export const auth = resource({
  label: "auth",
  depends: { lib: authModule },
  factory: async ({ lib }) => {
    const { betterAuth } = lib;

    return betterAuth({
      databaseHooks: {
        user: { create: { after: async ({ id }: { id: string }) => console.log(id) } },
      },
      hooks: { before: async () => undefined },
    });
  },
});

export const check = operation({
  label: "check",
  depends: { authModule },
  run: async ({ authModule }) => {
    const verify = authModule.verify;

    return verify("token", { jwksFetch: async () => [] });
  },
});
`;

/** Kysely's shape: \`new x.Kysely({...})\` and \`new Kysely({...})\` with option callbacks. */
const kyselyFile = `import { resource } from "@tinkered/core";

const kyselyModule = resource({
  label: "module:kysely",
  factory: () => import("kysely"),
});

export const db = resource({
  label: "db",
  depends: { x: kyselyModule },
  factory: ({ x }) => {
    const { Kysely } = x;
    const plain = new Kysely({ dialect: { createDriver: () => undefined } });

    return [plain, new x.Kysely({ dialect: { createDriver: () => undefined } })];
  },
});
`;

test("a library reached through a module resource passes: betterAuth's options", () => {
  const result = checkFiles({
    "tinker/auth/modules.ts": authModules,
    "tinker/auth/auth.ts": authFile,
  });

  expect(result).toMatchObject({ code: 0, err: "" });
});

test("new x.Kysely({...}) from a module resource passes, its options are native", () => {
  const result = checkFiles({ "tinker/db.ts": kyselyFile });

  expect(result).toMatchObject({ code: 0, err: "" });
});

test("a top-level helper beside module-resource calls still fails, on its own line", () => {
  const result = checkFiles({
    "tinker/auth/modules.ts": authModules,
    "tinker/auth/auth.ts": authFile,
    "tinker/db.ts": `${kyselyFile}\nconst helper = (n: number) => n + 1;\n\nexport const two = helper(1);\n`,
  });

  expect(result.code).toBe(1);
  expect(result.hits).toBe(hit("tinker/db.ts", 19));
});

test("a named helper inside a module-resource factory still fails, on its own line", () => {
  const result = checkFiles({
    "tinker/auth/modules.ts": authModules,
    "tinker/auth/auth.ts": authFile.replace(
      "    const { betterAuth } = lib;\n",
      "    const { betterAuth } = lib;\n    const helper = (n: number) => n + 1;\n    helper(1);\n",
    ),
  });

  expect(result.code).toBe(1);
  expect(result.hits).toBe(hit("tinker/auth/auth.ts", 10));
});

test("a resource that imports an app path is not a library: its options fail", () => {
  const result = checkFiles({
    "tinker/x.ts": `export const make = (options: object) => options;\n`,
    "tinker/modules.ts": `import { resource } from "@tinkered/core";

export const local = resource({ label: "local", factory: () => import("./x") });
export const aliased = resource({ label: "aliased", factory: () => import("~/x") });
`,
    "tinker/use.ts": `import { resource } from "@tinkered/core";

import { aliased, local } from "./modules";

export const used = resource({
  label: "used",
  depends: { local, aliased },
  factory: ({ local, aliased }) => [
    local.make({ start: () => 1 }),
    aliased.make({ start: () => 2 }),
  ],
});
`,
  });

  expect(result.code).toBe(1);
  expect(result.hits).toBe(
    [hit("tinker/use.ts", 9), hit("tinker/use.ts", 10), hit("tinker/x.ts", 1)].join("\n"),
  );
});

test("a factory that returns a package on one branch and app code on another is no library", () => {
  const result = checkFiles({
    "tinker/modules.ts": `import { resource } from "@tinkered/core";

export const branches = resource({
  label: "branches",
  factory: () => {
    if (Math.random() > 0.5) return import("kysely");
    return import("./x");
  },
});
`,
    "tinker/use.ts": `import { resource } from "@tinkered/core";

import { branches } from "./modules";

export const used = resource({
  label: "used",
  depends: { branches },
  factory: ({ branches }) => branches.make({ start: (n: number) => n + 1 }),
});
`,
  });

  expect(result.code).toBe(1);
  expect(result.hits).toBe(hit("tinker/use.ts", 8));
});

test("a ReadableStream source and a Proxy handler pass: the platform calls them", () => {
  const result = checkFiles({
    "tinker/stream.ts": `export const body = new ReadableStream<string>({
  start(controller) {
    controller.enqueue("a");
  },
  pull(controller) {
    controller.close();
  },
  cancel() {
    return undefined;
  },
});

export const guarded = new Proxy({ a: 1 }, {
  get(target, key) {
    return Reflect.get(target, key);
  },
});
`,
  });

  expect(result).toMatchObject({ code: 0, err: "" });
});

test("a const built on new Proxy is no library: a helper in its call's options fails", () => {
  const result = checkFiles({
    "tinker/store.ts": `import { appStore } from "./app-store";

export const store = new Proxy(appStore, {});
store.update({
  compute(n: number) {
    return n;
  },
});
`,
  });

  expect(result.code).toBe(1);
  expect(result.hits).toBe(hit("tinker/store.ts", 5));
});

test("a plain helper in the options of a global not on the list fails", () => {
  const result = checkFiles({
    "tinker/sink.ts": `export const sink = new WritableStream<string>({
  write(chunk) {
    console.log(chunk);
  },
});
`,
  });

  expect(result.code).toBe(1);
  expect(result.hits).toBe(hit("tinker/sink.ts", 2));
});

test("a top-level helper beside a ReadableStream and a Proxy still fails, on its own line", () => {
  const result = checkFiles({
    "tinker/stream.ts": `const helper = (n: number) => n + 1;

export const body = new ReadableStream<number>({
  start(controller) {
    controller.enqueue(helper(1));
  },
});

export const guarded = new Proxy({ a: 1 }, { get: (target, key) => Reflect.get(target, key) });
`,
  });

  expect(result.code).toBe(1);
  expect(result.hits).toBe(hit("tinker/stream.ts", 1));
});
