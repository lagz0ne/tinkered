import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScope } from "@tinker/core";
import { hono } from "../../src/hono/index.ts";
import { expect, test } from "vite-plus/test";
import { server } from "../../src/stack/index.ts";
import { readFreePort } from "./fixtures.ts";

test("serves the built index and assets with their content types", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stack-client-"));
  await mkdir(join(dir, "assets"));
  const files = [
    { path: "/", file: "index.html", body: "<h1>Built</h1>", type: "text/html; charset=UTF-8" },
    {
      path: "/assets/app.js",
      file: "assets/app.js",
      body: "export {};",
      type: "text/javascript; charset=utf-8",
    },
    {
      path: "/assets/app.css",
      file: "assets/app.css",
      body: "body{}",
      type: "text/css; charset=utf-8",
    },
    {
      path: "/assets/icon.bin",
      file: "assets/icon.bin",
      body: "bytes",
      type: "application/octet-stream",
    },
  ];
  for (const file of files) await writeFile(join(dir, file.file), file.body);
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const web = hono([]).extension;
  const scope = createScope({ extensions: [server(web, { env, clientDir: dir }), web] });
  try {
    await scope.ready;
    for (const file of files) {
      const response = await fetch(`http://${env.HOST}:${env.PORT}${file.path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(file.type);
      expect(await response.text()).toBe(file.body);
    }
  } finally {
    await scope.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing client files and unsafe asset names keep their HTTP answers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stack-missing-"));
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const web = hono([]).extension;
  const scope = createScope({ extensions: [server(web, { env, clientDir: dir }), web] });
  try {
    await scope.ready;
    for (const reply of [
      { path: "/", status: 503, body: "build the client first: vp run build" },
      { path: "/assets/no.js", status: 404, body: "missing" },
      { path: "/assets/bad..js", status: 400, body: "bad" },
      { path: "/assets/nested%2Fapp.js", status: 400, body: "bad" },
    ]) {
      const response = await fetch(`http://${env.HOST}:${env.PORT}${reply.path}`);
      expect({ status: response.status, body: await response.text() }).toEqual({
        status: reply.status,
        body: reply.body,
      });
    }
  } finally {
    await scope.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("file read errors reach the app error handler", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stack-unreadable-"));
  await mkdir(join(dir, "index.html"));
  await mkdir(join(dir, "assets", "app.js"), { recursive: true });
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const web = hono([], {
    mount: (app) => {
      app.onError((_error, c) => c.text("read failed", 500));
    },
  }).extension;
  const scope = createScope({ extensions: [server(web, { env, clientDir: dir }), web] });
  try {
    await scope.ready;
    for (const path of ["/", "/assets/app.js"]) {
      const response = await fetch(`http://${env.HOST}:${env.PORT}${path}`);
      expect({ status: response.status, body: await response.text() }).toEqual({
        status: 500,
        body: "read failed",
      });
    }
  } finally {
    await scope.close();
    await rm(dir, { recursive: true, force: true });
  }
});
