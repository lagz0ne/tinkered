import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, expect, test } from "vite-plus/test";

import { check } from "@/index";

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** Check a fresh app folder that holds only these files; answer `path:line` per plain function. */
function plainIn(files: Record<string, string | string[]>) {
  const folder = mkdtempSync(join(tmpdir(), "analyze-shapes-"));
  folders.push(folder);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), typeof text === "string" ? text : text.join("\n"));
  }

  return check(folder)
    .findings.filter(({ rule }) => rule === "tinker/plain")
    .map(({ path, line }) => `${path}:${line}`);
}

test("a name reaches its function through a cast, parens, or a branch, not a condition", () => {
  const hits = plainIn({
    "src/a.ts": [
      `export const cn = ((x: string) => x) as (x: string) => string;`,
      `export const b = { cn: ((x: string) => x) satisfies unknown };`,
      `export const c = { cn: ((x: string) => x)! };`,
      `export const d = { cn: <unknown>((x: string) => x) };`,
      `export const e = { cn: flag ? (x: string) => x : (x: string) => x + x };`,
      `export const f = { cn: maybe || ((x: string) => x) };`,
      `export const g = { cn: maybe ?? ((x: string) => x) };`,
      `export const h = { cn: maybe && ((x: string) => x) };`,
      `export const i = { cn: (() => 1) ? 1 : 2 };`,
      `export const j = { cn: 1 + (() => 1) };`,
      `export const k = { cn: 1 , other: (() => 1) as unknown };`,
    ],
  });

  expect(hits).toEqual(["src/a.ts:9", "src/a.ts:10", "src/a.ts:11"]);
});

test("a function takes its name from a class field, an assignment, or a quoted key", () => {
  const hits = plainIn({
    "tinker-analyze.json": JSON.stringify({
      plain: { entries: { "src/d.ts": { default: "The file's one entry." } } },
    }),
    "src/a.ts": [
      `export class A {`,
      `  cn = () => 1;`,
      `  other = () => 1;`,
      `  #cn = () => 1;`,
      `}`,
      `let cn;`,
      `cn = () => 1;`,
      `box.cn = () => 1;`,
      `export const quoted = { "cn": () => 1, [cn]: () => 1 };`,
    ],
    "src/d.ts": `export default () => 1;\n`,
    "src/e.ts": `export default () => 1;\n`,
  });

  expect(hits).toEqual(["src/a.ts:3", "src/a.ts:4", "src/a.ts:8", "src/a.ts:9", "src/e.ts:1"]);
});

test("a library value keeps its kind through a const in another app file", () => {
  const lib = [`import { make } from "pkg";`, `export const kit = make();`];
  const use = (from: string) => [
    `import { kit } from "${from}";`,
    `export const thing = kit.build({ onDone() {} });`,
  ];
  const hits = plainIn({
    "src/lib.ts": lib,
    "src/kit/index.mts": lib,
    "tinker/lib.cts": lib,
    "src/app.ts": [`import { helper } from "@/helper";`, `export const kit = helper();`],
    "src/helper.ts": `export const helper = cn;\n`,
    "src/a.ts": use("@/lib"),
    "src/b.ts": use("@/kit"),
    "src/c.ts": use("~/lib"),
    "src/deep/d.ts": use("../lib"),
    "src/e.ts": use("./lib"),
    "src/f.ts": use("@/app"),
    "src/g.ts": use("@/missing"),
    "cmds/h.ts": use("@/lib"),
  });

  expect(hits).toEqual(["src/f.ts:2", "src/g.ts:2"]);
});

test("the platform calls the options of a stream or a proxy, only as the direct callee", () => {
  const hits = plainIn({
    "src/a.ts": [
      `export const a = new ReadableStream({ start() {} });`,
      `export const b = new TransformStream({ transform() {} });`,
      `export const c = new Proxy(target, { get() {} });`,
      `export const d = new Other({ run() {} });`,
      `export const e = ReadableStream({ start() {} });`,
      `export const f = new mine.ReadableStream({ start() {} });`,
      `export const g = new ReadableStream({ start: () => {} }, [() => 1]);`,
    ],
  });

  expect(hits).toEqual(["src/a.ts:4", "src/a.ts:5", "src/a.ts:6"]);
});

test("a module resource is a library only as a dependency, the first parameter", () => {
  const head = [
    `import { operation, resource } from "@tinkered/core";`,
    `const auth = resource({ label: "auth", factory: () => import("better-auth") });`,
    `const local = resource({ label: "local", factory: () => import("./local") });`,
    `const mixed = resource({`,
    `  label: "mixed",`,
    `  factory: () => {`,
    `    if (flag) return import("@/local");`,
    `    return import("better-auth");`,
    `  },`,
    `});`,
    `const none = resource({ label: "none", factory: () => {} });`,
    `const other = make({ factory: () => import("better-auth") });`,
  ];
  const run = (depends: string, body: string) => [
    ...head,
    `export const go = operation({`,
    `  label: "go",`,
    `  depends: ${depends},`,
    `  run: ${body},`,
    `});`,
  ];
  const hits = plainIn({
    "src/a.ts": run(`{ x: auth }`, `({ x }) => x.make({ before() {} })`),
    "src/b.ts": run(`{ x: auth }`, `({ x: y }) => new y.Kit({ before() {} })`),
    "src/c.ts": run(`{ x: auth }`, `(_deps, { x }) => x.make({ before() {} })`),
    "src/d.ts": run(`{ x: local }`, `({ x }) => x.make({ before() {} })`),
    "src/e.ts": run(`{ x: mixed }`, `({ x }) => x.make({ before() {} })`),
    "src/f.ts": run(`{ x: none }`, `({ x }) => x.make({ before() {} })`),
    "src/g.ts": run(`{ x: other }`, `({ x }) => x.make({ before() {} })`),
    "src/h.ts": run(`{ x: auth.reader }`, `({ x }) => x.make({ before() {} })`),
    "src/i.ts": run(`{ auth }`, `({ auth }) => auth.make({ before() {} })`),
    "src/j.ts": run(`{ x: auth }`, `(x) => x.make({ before() {} })`),
    "src/k.ts": [
      ...head,
      `export const go = operation({`,
      `  label: "go",`,
      `  depends: { x: auth },`,
      `  run: ({ x }) => {`,
      `    const { betterAuth } = x;`,
      `    const db = new x.Kysely({ log() {} });`,
      `    let late;`,
      `    late.make({ before() {} });`,
      `    return [betterAuth({ before() {} }), db.with({ after() {} })];`,
      `  },`,
      `});`,
    ],
    "src/l.ts": [
      `import { operation } from "@tinkered/core";`,
      `import { auth } from "@/m";`,
      `export const go = operation({`,
      `  label: "go",`,
      `  depends: { x: auth },`,
      `  run: ({ x }) => x.make({ before() {} }),`,
      `});`,
    ],
    "src/m.ts": [
      `import { resource } from "@tinkered/core";`,
      `export const auth = resource({ label: "a", factory: () => import("better-auth") });`,
    ],
  });

  const made = "abcdefghijk".split("").map((name) => `src/${name}.ts:12`);
  const broken = ["c:16", "d:16", "e:16", "f:16", "g:16", "h:16", "j:16", "k:20"];
  expect(hits).toEqual([...made, ...broken.map((at) => `src/${at.replace(":", ".ts:")}`)].sort());
});

test("a hooks object is one typed Capsule.Hooks or passed to capsule by name", () => {
  const hits = plainIn({
    "src/a.ts": [
      `import { capsule, type Capsule } from "@tinkered/core";`,
      `const typed: Capsule.Hooks = { start() {}, other() {} };`,
      `const wrong: Capsule.Other = { start() {} };`,
      `const far: Other.Hooks = { start() {} };`,
      `const plain: Hooks = { start() {} };`,
      `const named = { close() {}, session: () => {} };`,
      `const spare = { close() {} };`,
      `export const one = capsule({ hooks: named });`,
      `export const two = make({ hooks: spare });`,
      `export const three = capsule({ hooks: { run() {}, write() {}, resolve() {} } });`,
      `export const four = capsule({ other: { run() {} } });`,
      `export const five = make({ hooks: { run() {} } });`,
    ],
  });

  expect(hits).toEqual([
    "src/a.ts:2",
    "src/a.ts:3",
    "src/a.ts:4",
    "src/a.ts:5",
    "src/a.ts:7",
    "src/a.ts:11",
    "src/a.ts:12",
  ]);
});

test("a function named inside an operation passes when the operation returns or hands it", () => {
  const hits = plainIn({
    "src/a.ts": [
      `import { operation } from "@tinkered/core";`,
      `export const go = operation({`,
      `  label: "go",`,
      `  run: () => {`,
      `    const back = () => 1;`,
      `    const called = () => 2;`,
      `    const keyed = () => 3;`,
      `    const member = () => 4;`,
      `    const given = () => 5;`,
      `    const short = () => 6;`,
      `    const valued = () => 7;`,
      `    const listed = () => 8;`,
      `    const api = { a() {}, deep: { b() {} } };`,
      `    const lost = { c() {} };`,
      `    called();`,
      `    use(given, { short }, { k: valued }, [listed]);`,
      `    use({ keyed: 1 }, box.member);`,
      `    return flag ? back : { api, d() {}, nested: { e() {} } };`,
      `  },`,
      `});`,
    ],
  });

  expect(hits).toEqual(["src/a.ts:6", "src/a.ts:7", "src/a.ts:8", "src/a.ts:12", "src/a.ts:14"]);
});

test("a component is a capitalized function in a .tsx file with JSX of its own", () => {
  const view = [
    `export const View = () => <b />;`,
    `export const view = () => <b />;`,
    `export const Named = function named() {`,
    `  return <b />;`,
    `};`,
    `export const lower = function Upper(props: object) {`,
    `  return <>{props}</>;`,
    `};`,
    `export const Two = (a: object, b: object) => <b>{a}{b}</b>;`,
    `export const Text = () => "text";`,
    `export function Outer() {`,
    `  return <ul>{items.map((item) => <li>{item}</li>)}</ul>;`,
    `}`,
    `export const Far = () => items.map((item) => <li>{item}</li>);`,
  ];
  const hits = plainIn({ "src/a.tsx": view, "src/b.ts": `export const View = () => 1;\n` });

  expect(hits).toEqual([
    "src/a.tsx:2",
    "src/a.tsx:3",
    "src/a.tsx:9",
    "src/a.tsx:10",
    "src/a.tsx:14",
    "src/b.ts:1",
  ]);
});

test("an unnamed function is inline as a callback of Core, a library, or an event", () => {
  const hits = plainIn({
    "src/a.ts": [
      `import { operation as op } from "@tinkered/core";`,
      `import lib, { part } from "pkg";`,
      `import * as all from "other";`,
      `import "side";`,
      `import { mine } from "@/mine";`,
      `op(() => 1);`,
      `lib.use(() => 1);`,
      `part([() => 1]);`,
      `all.use(() => 1);`,
      `mine(() => 1);`,
      `unknown(() => 1);`,
      `emitter.on("x", () => 1);`,
      `emitter.register(() => 1);`,
      `export const cn = () => () => 1;`,
      `export const list = [() => 1];`,
    ],
  });

  expect(hits).toEqual(["src/a.ts:10", "src/a.ts:11", "src/a.ts:13", "src/a.ts:15"]);
});

test("a top-level function handed to an event registration is a listener", () => {
  const names = [
    "addEventListener",
    "removeEventListener",
    "on",
    "once",
    "off",
    "defer",
    "dispose",
  ];
  const hits = plainIn({
    "src/a.ts": [
      ...names.map((name, index) => `function f${index}() {}\nsource.${name}("x", f${index});`),
      `function called() {}`,
      `source.on("x", called());`,
      `function other() {}`,
      `source.register(other);`,
      `function bare() {}`,
      `on(bare);`,
      `export const box = { inner() {} };`,
      `source.on("x", box.inner);`,
    ],
  });

  expect(hits).toEqual(["src/a.ts:15", "src/a.ts:17", "src/a.ts:19", "src/a.ts:21"]);
});
