import { createServer } from "node:net";
import { createScope, resource } from "@tinker/core";
import { hono } from "@tinker/hono";
import { server } from "@tinker/stack";
import { expect, test } from "vite-plus/test";
import { auth, isError } from "../src/index.ts";

const database = resource({ label: "unused.db", factory: () => Promise.resolve({}) });

async function readFreePort() {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (address === null || typeof address === "string") return expect.unreachable();
  const port = String(address.port);
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

test.each([
  { config: undefined, keys: ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"] },
  { config: { BETTER_AUTH_URL: "http://localhost:3000" }, keys: ["BETTER_AUTH_SECRET"] },
  { config: { BETTER_AUTH_SECRET: "x".repeat(32) }, keys: ["BETTER_AUTH_URL"] },
  {
    config: { BETTER_AUTH_SECRET: "x".repeat(31), BETTER_AUTH_URL: "not a url" },
    keys: ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"],
  },
  {
    config: { BETTER_AUTH_SECRET: "x".repeat(32), BETTER_AUTH_URL: "ftp://example.com" },
    keys: ["BETTER_AUTH_URL"],
  },
])(
  "bad auth settings stop boot before the port opens and name every bad key: $keys",
  async ({ config, keys }) => {
    const identity = auth(database, {});
    const web = hono([], identity.wiring).extension;
    const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
    const scope = createScope({
      tags: config ? [identity.config(config)] : [],
      extensions: [server(web, { env, clientDir: "/missing" }), web, identity.extension],
    });
    try {
      await scope.ready;
      expect.unreachable();
    } catch (error) {
      if (!isError(error, "BadAuthSettings")) throw error;
      expect(error.payload.keys).toEqual(keys);
      await expect(fetch(`http://${env.HOST}:${env.PORT}/api/auth/get-session`)).rejects.toThrow();
    } finally {
      await scope.close();
    }
  },
);

test("auth wiring without its started piece rejects the request with a named error", async () => {
  const identity = auth(database, {});
  let failure: unknown;
  const web = hono([], {
    ...identity.wiring,
    mount: (app) => {
      identity.wiring.mount?.(app);
      app.onError((error, c) => {
        failure = error;
        return c.text("not started", 503);
      });
    },
  }).extension;
  const scope = createScope({ extensions: [web] });
  try {
    await scope.ready;
    expect((await scope.resolve(web).request("/api/auth/get-session")).status).toBe(503);
    if (!isError(failure, "NotStarted")) throw failure;
    expect(failure.payload).toEqual({ label: "auth" });
  } finally {
    await scope.close();
  }
});

test("HTTPS and a 32 character secret pass the boot settings check", async () => {
  const identity = auth(database, {});
  const scope = createScope({
    tags: [
      identity.config({
        BETTER_AUTH_SECRET: "x".repeat(32),
        BETTER_AUTH_URL: "https://example.com",
      }),
    ],
    extensions: [identity.extension],
  });
  try {
    await scope.ready;
  } finally {
    await scope.close();
  }
});
