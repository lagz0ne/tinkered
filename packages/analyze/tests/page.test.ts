import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, expect, test } from "vite-plus/test";

import { check } from "@/index";

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** Check a fresh app folder that holds only these files; answer each page-rule finding as text. */
function checkFiles(files: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), "analyze-page-"));
  folders.push(folder);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }

  return check(folder)
    .findings.filter(({ rule }) => rule !== "tinker/plain")
    .map(({ path, line, rule, what }) => [path, line, rule, what.split(":")[0]].join(" "));
}

test("a page's own network call breaks tinker/one-wire, however it is built", () => {
  const hits = checkFiles({
    "src/page.tsx": [
      `export const load = operation({`,
      `  run: () => {`,
      `    fetch("/api");`,
      `    window.fetch("/api");`,
      `    new WebSocket("ws://x");`,
      `    globalThis.WebSocket("ws://x");`,
      `    new XMLHttpRequest();`,
      `    new EventSource("/sse");`,
      `    EventSource("/sse");`,
      `    navigator.sendBeacon("/hit");`,
      `  },`,
      `});`,
    ].join("\n"),
  });

  expect(hits).toEqual([
    "src/page.tsx 3 tinker/one-wire `fetch`",
    "src/page.tsx 4 tinker/one-wire `fetch`",
    "src/page.tsx 5 tinker/one-wire `WebSocket`",
    "src/page.tsx 6 tinker/one-wire `WebSocket`",
    "src/page.tsx 7 tinker/one-wire `XMLHttpRequest`",
    "src/page.tsx 8 tinker/one-wire `EventSource`",
    "src/page.tsx 9 tinker/one-wire `EventSource`",
    "src/page.tsx 10 tinker/one-wire `sendBeacon`",
  ]);
});

test("a socket on any global object is a finding; a cast in a .ts file hides nothing", () => {
  const hits = checkFiles({
    "src/a.ts": [
      `const one = <number>(<unknown>1);`,
      `window.WebSocket("ws://x");`,
      `self.EventSource("/sse");`,
      `global.XMLHttpRequest();`,
      `export { one };`,
    ].join("\n"),
    "src/b.jsx": `export const View = () => <b onClick={() => fetch("/api")} />;\n`,
  });

  expect(hits).toEqual([
    "src/a.ts 2 tinker/one-wire `WebSocket`",
    "src/a.ts 3 tinker/one-wire `EventSource`",
    "src/a.ts 4 tinker/one-wire `XMLHttpRequest`",
    "src/b.jsx 1 tinker/one-wire `fetch`",
  ]);
});

test("a read of fetch, a word in a string, and a socket on another object pass", () => {
  const hits = checkFiles({
    "src/page.tsx": [
      `export const load = operation({`,
      `  run: () => {`,
      `    const send = page.fetch;`,
      `    keep(page.fetch, React.useState);`,
      `    const text = "fetch(1) new WebSocket() useState()";`,
      `    sockets.WebSocket("ws://x");`,
      `    return [send, text];`,
      `  },`,
      `});`,
    ].join("\n"),
  });

  expect(hits).toEqual([]);
});

test("React's state and effect hooks break tinker/react-state under any name", () => {
  const hits = checkFiles({
    "src/named.tsx": [
      `import { useEffect as watch, useState, useMemo } from "react";`,
      `export const View = () => {`,
      `  const [n] = useState(0);`,
      `  watch(() => {});`,
      `  useMemo(() => n, [n]);`,
      `  return <b>{n}</b>;`,
      `};`,
    ].join("\n"),
    "src/whole.tsx": [
      `import React from "react";`,
      `import * as R from "react";`,
      `const { useReducer: reduce, useMemo } = React;`,
      `export const View = () => {`,
      `  React.useLayoutEffect(() => {});`,
      `  R.useState(0);`,
      `  reduce(() => 0, 0);`,
      `  useMemo(() => 0, []);`,
      `  return <b />;`,
      `};`,
    ].join("\n"),
    "src/bare.tsx": `export const View = () => {\n  useReducer(() => 0, 0);\n  return <b />;\n};\n`,
  });

  expect(hits).toEqual([
    "src/bare.tsx 2 tinker/react-state `useReducer`",
    "src/named.tsx 3 tinker/react-state `useState`",
    "src/named.tsx 4 tinker/react-state `useEffect`",
    "src/whole.tsx 5 tinker/react-state `useLayoutEffect`",
    "src/whole.tsx 6 tinker/react-state `useState`",
    "src/whole.tsx 7 tinker/react-state `useReducer`",
  ]);
});

test("a hook of the same name on another object or from another package passes", () => {
  const hits = checkFiles({
    "src/a.tsx": [
      `import { useState as keep } from "preact/hooks";`,
      `import Lib from "lib";`,
      `const { useState: mine } = Lib;`,
      `const { useReducer: [first] } = load();`,
      `const [useEffect] = Lib.hooks;`,
      `export const View = () => {`,
      `  keep(0);`,
      `  mine(0);`,
      `  Lib.useEffect(() => {});`,
      `  return <b />;`,
      `};`,
    ].join("\n"),
  });

  expect(hits).toEqual([]);
});

test("the page is src/ less its .server and .d files; cmds/ and tinker/ are not the page", () => {
  const call = `export const load = operation({ run: () => fetch("/api") });\n`;
  const hits = checkFiles({
    "src/a.ts": call,
    "src/b.server.ts": call,
    "src/deep/c.mjs": call,
    "src/types.d.ts": call,
    "cmds/server.ts": call,
    "tinker/components/http/backend.ts": call,
  });

  expect(hits).toEqual([
    "src/a.ts 1 tinker/one-wire `fetch`",
    "src/deep/c.mjs 1 tinker/one-wire `fetch`",
  ]);
});

test("the app's config names the page's files and skips a glob with a reason", () => {
  const call = `export const load = operation({ run: () => fetch("/api") });\n`;
  const hits = checkFiles({
    "tinker-analyze.json": JSON.stringify({
      page: { files: ["src/frontend/**", "web/*.ts"], skip: { "src/frontend/bench/**": "Why." } },
    }),
    "src/frontend/a.ts": call,
    "src/frontend/bench/b.ts": call,
    "src/backend/c.ts": call,
    "web/d.ts": call,
  });

  expect(hits).toEqual([
    "src/frontend/a.ts 1 tinker/one-wire `fetch`",
    "web/d.ts 1 tinker/one-wire `fetch`",
  ]);
});
