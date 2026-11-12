import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, expect, test } from "vite-plus/test";

import { check } from "@/index";

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** Check a fresh app folder that holds only these files; answer `path:line what` per finding. */
function plainIn(files: Record<string, string | string[]>) {
  const folder = mkdtempSync(join(tmpdir(), "analyze-called-"));
  folders.push(folder);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), typeof text === "string" ? text : text.join("\n"));
  }

  return check(folder)
    .findings.filter(({ rule }) => rule === "tinker/plain")
    .map(({ path, line, what }) => `${path}:${line} ${what}`);
}

const helper = (at: string, site: string) => `${at} a helper, called by name at ${site}`;

test("a pure function kept by useCallback and called by name fails; one that holds state passes", () => {
  const hits = plainIn({
    "src/page.tsx": [
      `import { useCallback } from "react";`,
      `export function Page({ step }: { step: number }) {`,
      `  const add = useCallback((a: number, b: number) => a + b, []);`,
      `  const plus = add;`,
      `  const more = useCallback((a: number) => a + step, [step]);`,
      `  const idle = useCallback((a: number) => a, []);`,
      `  return <p onClick={idle}>{plus(1, 2) + more(1)}</p>;`,
      `}`,
    ],
    "src/own.tsx": [
      `import { useCallback } from "@/hooks";`,
      `import { useMemo } from "react";`,
      `export function Page() {`,
      `  const add = useCallback((a: number, b: number) => a + b, []);`,
      `  const made = useMemo(() => 1, []);`,
      `  return <p>{add(1, 2) + made()}</p>;`,
      `}`,
    ],
  });

  expect(hits).toEqual([helper("src/page.tsx:3", "src/page.tsx:7")]);
});

test("an owned function that holds no state and is called by name fails", () => {
  const hits = plainIn({
    "src/a.ts": [
      `import { resource } from "@tinkered/core";`,
      `export const talk = resource({`,
      `  label: "talk",`,
      `  factory: ({ secret }: { secret: string }) => {`,
      `    let sent = 0;`,
      `    const owned = {`,
      `      plain(text: string) {`,
      `        return text.trim();`,
      `      },`,
      `      redact: (text: string) => text.replaceAll(secret, "*"),`,
      `      count() {`,
      `        return ++sent;`,
      `      },`,
      `      self() {`,
      `        return this;`,
      `      },`,
      `      send(text: string) {`,
      `        owned.self();`,
      `        owned.count();`,
      `        return owned.redact(owned.plain(text));`,
      `      },`,
      `    };`,
      `    return owned;`,
      `  },`,
      `});`,
    ],
  });

  expect(hits).toEqual([helper("src/a.ts:7", "src/a.ts:20")]);
});

test("a function handed to a call and then called by name fails, unless it holds state", () => {
  const hits = plainIn({
    "src/a.ts": [
      `import { operation } from "@tinkered/core";`,
      `export const use = operation({`,
      `  label: "use",`,
      `  run: (_deps, { input }: { input: number }) => {`,
      `    const add = (a: number, b: number) => a + b;`,
      `    function twice(a: number) {`,
      `      return a * 2;`,
      `    }`,
      `    const scaled = (a: number) => a * input;`,
      `    function shadow(input: number) {`,
      `      const { length } = [input];`,
      `      return length;`,
      `    }`,
      `    queueMicrotask(add as never);`,
      `    [1].map(twice).map(scaled).map(shadow);`,
      `    return [add(1, 2), twice(1), scaled(1), shadow(1)].map((n) => (add)(n, n));`,
      `  },`,
      `});`,
    ],
  });

  expect(hits).toEqual([
    helper("src/a.ts:5", "src/a.ts:16"),
    helper("src/a.ts:6", "src/a.ts:16"),
    helper("src/a.ts:10", "src/a.ts:16"),
  ]);
});

test("a name used only as a key is no state; a read of an outer name or function is", () => {
  const hits = plainIn({
    "src/a.tsx": [
      `import { operation } from "@tinkered/core";`,
      `export const use = operation({`,
      `  label: "use",`,
      `  run: (_deps, { input: [first, { seed }] }: { input: [number, { seed: number }] }) => {`,
      `    function inner() {`,
      `      return first;`,
      `    }`,
      `    const bag = {`,
      `      key: (box: { seed: number }) => box.seed,`,
      `      made: () => ({ seed: 1 }),`,
      `      seed() {`,
      `        return 2;`,
      `      },`,
      `      pick: ({ seed: mine }: { seed: number }) => mine,`,
      `      attr: () => <p seed="x" />,`,
      `      typed: (value: typeof seed) => value,`,
      `      short: () => ({ seed }),`,
      `      head: () => first,`,
      `      calls: () => inner(),`,
      `    };`,
      `    const all = [bag.key({ seed }), bag.made(), bag.seed(), bag.pick({ seed }), bag.attr()];`,
      `    return { bag, all, inner, rest: [bag.typed(1), bag.short(), bag.head(), bag.calls()] };`,
      `  },`,
      `});`,
    ],
  });

  expect(hits).toEqual([
    helper("src/a.tsx:9", "src/a.tsx:21"),
    helper("src/a.tsx:10", "src/a.tsx:21"),
    helper("src/a.tsx:11", "src/a.tsx:21"),
    helper("src/a.tsx:14", "src/a.tsx:21"),
    helper("src/a.tsx:15", "src/a.tsx:21"),
    helper("src/a.tsx:16", "src/a.tsx:22"),
  ]);
});

test("a component called as a function fails, from its file or through an import", () => {
  const hits = plainIn({
    "src/price.tsx": [
      `export function Price(props: { a: number }) {`,
      `  return <b>{props.a}</b>;`,
      `}`,
      `export const Total = (props: { a: number }) => <b>{props.a}</b>;`,
      `export function Shown() {`,
      `  return <Price a={1} />;`,
      `}`,
    ],
    "src/views/index.tsx": `export function Note() {\n  return <i />;\n}\n`,
    "src/page.tsx": [
      `import { Price as Cost, Total } from "@/price";`,
      `import { Note } from "./views";`,
      `export function Page() {`,
      `  return <p>{Cost({ a: 1 })}{Total({ a: 2 })}{Note()}</p>;`,
      `}`,
    ],
  });

  expect(hits).toEqual([
    helper("src/price.tsx:1", "src/page.tsx:4"),
    helper("src/price.tsx:4", "src/page.tsx:4"),
    helper("src/views/index.tsx:1", "src/page.tsx:4"),
  ]);
});

test("a call the syntax cannot follow is no finding", () => {
  const hits = plainIn({
    "src/a.tsx": [
      `import { operation } from "@tinkered/core";`,
      `import { memoize } from "lodash";`,
      `export function View({ render }: { render: () => unknown }) {`,
      `  return <p>{render()}</p>;`,
      `}`,
      `export const server = Bun.serve({`,
      `  fetch(request: Request) {`,
      `    return new Response(request.url);`,
      `  },`,
      `});`,
      `export const reply = server.fetch(new Request("http://x"));`,
      `export const kept = memoize((a: number) => a);`,
      `export const one = kept(1);`,
      `export const use = operation({`,
      `  label: "use",`,
      `  run: (_deps, { input }: { input: { View(): number } }) => {`,
      `    const { View } = input;`,
      `    const [first] = [View];`,
      `    let later: undefined | (() => number);`,
      `    return [View(), first(), later?.(), input.View(), unknown()];`,
      `  },`,
      `});`,
    ],
  });

  expect(hits).toEqual([]);
});

test("an entry called by name passes", () => {
  const hits = plainIn({
    "tinker-analyze.json": JSON.stringify({
      plain: { entries: { "src/classes.ts": { cn: "shadcn's registry imports it." } } },
    }),
    "src/classes.ts": `export function cn(...names: string[]) {\n  return names.join(" ");\n}\n`,
    "src/page.tsx": [
      `import { cn } from "./classes";`,
      `export function Page() {`,
      `  return <p className={cn("a", "b")} />;`,
      `}`,
    ],
  });

  expect(hits).toEqual([]);
});

test("a helper has one finding: its first call in file order", () => {
  const hits = plainIn({
    "src/a.tsx": [
      `import { Mark } from "./b";`,
      `export function Page() {`,
      `  return <p>{Mark()}{Mark()}</p>;`,
      `}`,
    ],
    "src/b.tsx": [
      `export function Mark() {`,
      `  return <i />;`,
      `}`,
      `export function Twice() {`,
      `  return <p>{Mark()}</p>;`,
      `}`,
    ],
  });

  expect(hits).toEqual([helper("src/b.tsx:1", "src/a.tsx:3")]);
});

test("an unnamed function is inline in each event registration", () => {
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
      ...names.map((name) => `source.${name}("x", () => 1);`),
      `source.register(() => 1);`,
    ],
  });

  expect(hits).toEqual(["src/a.ts:8 a plain function"]);
});

test("a workflow calls its step by name; a plain file that calls a step fails", () => {
  const hits = plainIn({
    "src/naming/naming.flow.server.ts": [
      `export async function nameFlow(input: { idea: string }) {`,
      `  "use workflow";`,
      `  const parts = [input.idea].map((s) => suggest(s));`,
      `  return await suggest(input.idea) + parts.length;`,
      `}`,
      `export async function suggest(idea: string) {`,
      `  "use step";`,
      `  return idea + "!";`,
      `}`,
    ],
    "src/naming/start.server.ts": [
      `import { start } from "workflow/api";`,
      `import { nameFlow, suggest } from "./naming.flow.server";`,
      `export const kick = start(nameFlow, [{ idea: "a" }]);`,
      `export const cheat = suggest("b");`,
    ],
  });

  expect(hits).toEqual([
    helper("src/naming/naming.flow.server.ts:6", "src/naming/start.server.ts:4"),
  ]);
});
