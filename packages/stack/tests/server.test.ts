import { createScope, extension, operation } from "@tinker/core";
import { hono, route } from "@tinker/hono";
import { expect, test } from "vite-plus/test";
import { jsonLines, runUntilStop, server } from "../src/index.ts";
import { readFreePort } from "./fixtures.ts";

const answer = operation({ label: "answer", run: () => "ready" });

test("opens the port only after every other start finishes", async () => {
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const later = extension({
    label: "later",
    start: async (_scope, _ctx, next) => {
      await next();
      entered.resolve();
      await release.promise;
    },
  });
  const lines: string[] = [];
  const observe = jsonLines((line) => lines.push(line));
  const web = hono([route.get("/ready", answer)]).extension;
  const scope = createScope({
    extensions: [server(web, { env, clientDir: "/missing-client", observe }), web, later],
    observe,
  });
  const base = `http://${env.HOST}:${env.PORT}`;
  try {
    await entered.promise;
    await expect(fetch(`${base}/ready`)).rejects.toThrow();
    release.resolve();
    await scope.ready;
    expect(await (await fetch(`${base}/ready`)).json()).toBe("ready");
    expect(lines.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({
        kind: "log",
        message: "listening",
        host: env.HOST,
        port: Number(env.PORT),
      }),
    );
  } finally {
    release.resolve();
    await scope.close();
  }
  await expect(fetch(`${base}/ready`)).rejects.toThrow();
});

test("a stop waits for an in-flight request and answers zero", async () => {
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const closing = Promise.withResolvers<void>();
  const slow = operation({
    label: "slow",
    run: async (_deps, ctx) => {
      entered.resolve();
      await release.promise;
      return { aborted: ctx.signal.aborted };
    },
  });
  const web = hono([route.get("/slow", slow)]).extension;
  const scope = createScope({
    extensions: [
      server(web, { env, clientDir: "/missing-client" }),
      web,
      extension({
        label: "closing",
        close: (_opts, next) => {
          closing.resolve();
          return next();
        },
      }),
    ],
  });
  const stop = new AbortController();
  const ended = runUntilStop(scope, stop.signal, { clock: Date.now });
  let didEnd = false;
  const joined = ended.then((code) => {
    didEnd = true;
    return code;
  });
  try {
    await scope.ready;
    const request = fetch(`http://${env.HOST}:${env.PORT}/slow`, {
      headers: { connection: "close" },
    });
    await entered.promise;
    stop.abort();
    await closing.promise;
    expect(didEnd).toBe(false);
    release.resolve();
    expect(await (await request).json()).toEqual({ aborted: false });
    expect(await joined).toBe(0);
    await expect(fetch(`http://${env.HOST}:${env.PORT}/slow`)).rejects.toThrow();
  } finally {
    release.resolve();
    stop.abort();
    await joined;
  }
});

test.each(["127.0.0.1", "::1"])(
  "an already stopped signal closes after boot and answers zero (%s)",
  async (HOST) => {
    const env = { HOST, PORT: await readFreePort() };
    const web = hono([]).extension;
    const scope = createScope({ extensions: [server(web, { env, clientDir: "/missing" }), web] });
    expect(await runUntilStop(scope, AbortSignal.abort(), { clock: Date.now })).toBe(0);
    await expect(
      fetch(`http://[${env.HOST === "::1" ? "::1" : "::ffff:127.0.0.1"}]:${env.PORT}/`),
    ).rejects.toThrow();
  },
);

test("failed boot waits for cleanup before logging and answering one", async () => {
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const cleaned = Promise.withResolvers<void>();
  const cleaning = Promise.withResolvers<void>();
  const web = hono([]).extension;
  const broken = extension({
    label: "broken",
    start: (_scope, ctx) => {
      ctx.defer(() => {
        cleaning.resolve();
        return cleaned.promise;
      });
      throw new Error("boot broke");
    },
  });
  const scope = createScope({
    extensions: [server(web, { env, clientDir: "/missing" }), web, broken],
  });
  const lines: string[] = [];
  const observe = { ...jsonLines((line) => lines.push(line)), clock: () => 42 };
  const ended = runUntilStop(scope, new AbortController().signal, observe);
  try {
    await cleaning.promise;
    expect(lines).toEqual([]);
    await expect(fetch(`http://${env.HOST}:${env.PORT}/`)).rejects.toThrow();
  } finally {
    cleaned.resolve();
  }
  expect(await ended).toBe(1);
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({
      kind: "log",
      time: 42,
      level: 50,
      message: "boot failed",
      error: "boot broke",
    }),
  ]);
});

test("a failed close logs shutdown failed and answers one", async () => {
  const failed = operation({
    label: "failed",
    run: async () => {
      throw new Error("work broke");
    },
  });
  const scope = createScope();
  await expect(scope.run(failed)).rejects.toThrow();
  const lines: string[] = [];
  expect(
    await runUntilStop(scope, AbortSignal.abort(), {
      ...jsonLines((line) => lines.push(line)),
      clock: Date.now,
    }),
  ).toBe(1);
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({
      message: "shutdown failed",
      error: "work broke",
      time: expect.any(Number),
      level: 50,
    }),
  ]);
});

test("teardown errors log shutdown failed and answer one", async () => {
  const scope = createScope();
  scope.onClose(() => {
    throw new Error("close broke");
  });
  const lines: string[] = [];
  expect(
    await runUntilStop(scope, AbortSignal.abort(), {
      ...jsonLines((line) => lines.push(line)),
      clock: Date.now,
    }),
  ).toBe(1);
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({
      message: "shutdown failed",
      teardown: [expect.objectContaining({ error: "close broke" })],
    }),
  ]);
});

test("a port already in use fails boot without closing its owner", async () => {
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const first = hono([route.get("/ready", answer)]).extension;
  const owner = createScope({ extensions: [server(first, { env, clientDir: "/missing" }), first] });
  const second = hono([]).extension;
  await owner.ready;
  const refused = createScope({
    extensions: [server(second, { env, clientDir: "/missing" }), second],
  });
  try {
    const lines: string[] = [];
    expect(
      await runUntilStop(refused, new AbortController().signal, {
        ...jsonLines((line) => lines.push(line)),
        clock: Date.now,
      }),
    ).toBe(1);
    expect(lines.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({ message: "boot failed" }),
    );
    expect(await (await fetch(`http://${env.HOST}:${env.PORT}/ready`)).json()).toBe("ready");
  } finally {
    await refused.close();
    await owner.close();
  }
});
