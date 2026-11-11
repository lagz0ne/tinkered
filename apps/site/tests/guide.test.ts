import { serve } from "@tinker/bun";
import { createScope } from "@tinker/core";
import type { Scope } from "@tinker/core";
import { memory } from "@tinker/core/testing";
import { afterAll, expect, test } from "vite-plus/test";

import { guide } from "@/guide";
import { guideOps } from "@/guide/index.server";

// The guide, both ways in: people read pages over rpc, agents read markdown over plain GET.

const server = await createScope({
  capsules: [guide.api({ implement: guideOps }), memory.server({ services: [guide.api] })],
}).ready;

const client = await createScope({
  capsules: [memory.client({ peer: server }), guide.api({ remote: memory.client })],
}).ready;

type Server = typeof import("../cmds/server");
const cmd: Server = await import(new URL("../cmds/server.ts", import.meta.url).href);
const collector = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) });
const stop = new AbortController();

const site = (await cmd.default({
  env: {
    PORT: "0",
    OTEL_SERVICE_NAME: "guide-test",
    VICTORIA_TRACES_URL: `${collector.url}traces`,
    VICTORIA_LOGS_URL: `${collector.url}logs`,
  },
  args: [],
  cwd: process.cwd(),
  signal: stop.signal,
  stdout: { write: () => true },
  stderr: { write: () => true },
  exit: (code, reason) => stop.abort(reason ?? code),
})) as Scope.Starting & { readonly closed: Promise<unknown> };

const base = site.resolve(serve.url).get()!;

afterAll(async () => {
  await client.close();
  await server.close();
  stop.abort();
  await site.closed;
  await collector.stop();
});

const get = (path: string) => fetch(new URL(path, base));

const file = (slug: string) =>
  Bun.file(new URL(`../src/guide/pages/${slug}.md`, import.meta.url)).text();

test("the list names every page in reading order, each with its first paragraph, as plain text", async () => {
  const pages = await client.run(guide.api["guide.list"], { input: null });

  expect(pages.map((p) => p.slug)).toEqual([
    "start",
    "operation",
    "data",
    "resource",
    "capsule",
    "rpc",
    "remote-data",
    "react",
    "testing",
    "rules",
  ]);
  expect(pages[0]).toEqual({
    slug: "start",
    title: "Start",
    summary:
      "Tinker is a TypeScript library for apps. You write the app as a graph of small units. Core runs the graph, traces each call, and closes it.",
  });
});

test("a page comes as HTML with the pages on each side; an unknown one is gone", async () => {
  const rpc = await client.run(guide.api["guide.page"], { input: { slug: "rpc" } });

  expect(rpc).toMatchObject({
    kind: "found",
    title: "rpc",
    prev: { slug: "capsule" },
    next: { slug: "remote-data" },
  });
  expect(rpc.kind === "found" && rpc.html).toContain("<h1>rpc</h1>");
  expect(await client.run(guide.api["guide.page"], { input: { slug: "start" } })).toMatchObject({
    prev: null,
  });
  expect(await client.run(guide.api["guide.page"], { input: { slug: "nope" } })).toEqual({
    kind: "gone",
  });
});

test("a slug that is not a page name is refused at the door", async () => {
  const result = await client.settle(guide.api["guide.page"], { input: { slug: "../x" } });

  expect(result.status).toBe("failed");
});

test("/llms.txt links each page's markdown, with its first paragraph, as plain text", async () => {
  const reply = await get("/llms.txt");
  const text = await reply.text();

  expect(reply.headers.get("content-type")).toContain("text/plain");
  expect(text.startsWith("# Tinker\n\n> ")).toBe(true);
  expect(text).toContain("- [rpc](/llms/rpc.md): rpc is one contract for both sides.");
  expect(text).toContain("- [Every page](/llms-full.txt)");
});

test("/llms/<page>.md is the page as written; an unknown page is 404", async () => {
  const reply = await get("/llms/remote-data.md");

  expect(reply.headers.get("content-type")).toContain("text/markdown");
  expect(await reply.text()).toBe(await file("remote-data"));
  expect((await get("/llms/nope.md")).status).toBe(404);
});

test("/llms-full.txt is every page, in reading order", async () => {
  const text = await (await get("/llms-full.txt")).text();

  expect(text.startsWith(await file("start"))).toBe(true);
  expect(text.endsWith(await file("rules"))).toBe(true);
});
