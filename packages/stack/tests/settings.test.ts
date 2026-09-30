import { createScope, extension } from "@tinker/core";
import { hono } from "@tinker/hono";
import { expect, test } from "vite-plus/test";
import { isError, server, type Server } from "../src/index.ts";
import { readFreePort } from "./fixtures.ts";

test.each([undefined, "", "abc", "80x", "0", "65536", "-1", "1.2", " 80"])(
  "a bad PORT fails ready and names PORT (%s)",
  async (PORT) => {
    const web = hono([]).extension;
    let started = false;
    const later = extension({
      label: "later",
      hooks: {
        start: () => {
          started = true;
        },
      },
    });
    const scope = createScope({
      extensions: [
        server(web, { env: { HOST: "127.0.0.1", PORT }, clientDir: "/missing" }),
        web,
        later,
      ],
    });
    try {
      await scope.ready;
      expect.unreachable();
    } catch (error) {
      if (!isError(error, "BadListenSettings")) throw error;
      expect(error.payload.keys).toEqual(["PORT"]);
      expect(started).toBe(false);
    } finally {
      await scope.close();
    }
  },
);

test.each([
  undefined,
  "",
  " ",
  "http://localhost",
  "bad host",
  "-host",
  "host-",
  "a".repeat(64),
  `${"a.".repeat(127)}a`,
])("a bad HOST fails before its free port opens (%s)", async (HOST) => {
  const PORT = await readFreePort();
  const web = hono([]).extension;
  const scope = createScope({
    extensions: [server(web, { env: { PORT, HOST }, clientDir: "/missing" }), web],
  });
  try {
    await scope.ready;
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "BadListenSettings")) throw error;
    expect(error.payload.keys).toEqual(["HOST"]);
    await expect(fetch(`http://127.0.0.1:${PORT}/`)).rejects.toThrow();
  } finally {
    await scope.close();
  }
});

test.each<Server.Env>([{}, { PORT: "abc", HOST: "bad host" }])(
  "one error names every missing or bad listen key (%j)",
  async (env) => {
    const web = hono([]).extension;
    const scope = createScope({ extensions: [server(web, { env, clientDir: "/missing" }), web] });
    try {
      await scope.ready;
      expect.unreachable();
    } catch (error) {
      if (!isError(error, "BadListenSettings")) throw error;
      expect(error.payload.keys).toEqual(["PORT", "HOST"]);
    } finally {
      await scope.close();
    }
  },
);

test.each<Server.Env>([
  { PORT: "1", HOST: "a" },
  { PORT: "65535", HOST: "my-host.example" },
  { PORT: "00080", HOST: "a".repeat(63) },
  { PORT: "80", HOST: `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}` },
])("valid listen limits let the next start run (%j)", async (env) => {
  const reached = new Error("next start reached");
  const next = extension({
    label: "next",
    hooks: {
      start: () => {
        throw reached;
      },
    },
  });
  const web = hono([]).extension;
  const scope = createScope({
    extensions: [server(web, { env, clientDir: "/missing" }), web, next],
  });
  try {
    await expect(scope.ready).rejects.toBe(reached);
  } finally {
    await scope.close();
  }
});
