import { createScope, isError, type Capsule } from "@tinker/core";
import { preset } from "@tinker/core/testing";
import { expect, test } from "vite-plus/test";

import { auth } from "#tinker/app.server";

import { handleAuth } from "../src/parts/auth/handle.server";
import { auth as off } from "../src/parts/auth/off";
import { auth as on } from "../src/parts/auth/on.server";
import { authSettings, authStartup } from "../src/parts/auth/settings";

const settings = { origin: "https://shop.example", secret: "s".repeat(32) };

test("handleAuth hands the whole request to the app's auth library and returns its reply", async () => {
  const root = createScope();
  const get = await root.settle(handleAuth, {
    input: new Request("http://app/api/auth/get-session"),
  });
  if (get.status !== "success") throw get;
  expect(await get.value.json()).toEqual({ method: "GET", path: "/api/auth/get-session" });

  const post = await root.settle(handleAuth, {
    input: new Request("http://app/api/auth/sign-in/email", { method: "POST", body: "{}" }),
  });
  if (post.status !== "success") throw post;
  expect(await post.value.json()).toEqual({ method: "POST", path: "/api/auth/sign-in/email" });
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("handleAuth takes only a request, and a failing auth library fails the call", async () => {
  const lost = new Error("auth store lost");
  const root = createScope({
    presets: [
      preset(auth, () => ({
        handler: async () => {
          throw lost;
        },
        api: { getSession: async () => null },
      })),
    ],
  });
  expect((await root.settle(handleAuth, { rawInput: "/api/auth/get-session" })).status).toBe(
    "failed",
  );
  expect(
    await root.settle(handleAuth, { input: new Request("http://app/api/auth/get-session") }),
  ).toMatchObject({ status: "failed", error: lost });
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("the part fills its settings from its two keys at the entry", async () => {
  const root = createScope({
    capsules: on.capsules({ PUBLIC_ORIGIN: "https://shop.example", AUTH_SECRET: "s".repeat(32) }),
  });
  await root.ready;
  expect(root.resolve(authSettings)).toEqual({
    origin: "https://shop.example",
    secret: "s".repeat(32),
  });
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("an unset, empty, or refused key is named in one BadSettings, before any scope", () => {
  expect(() => on.capsules({ PUBLIC_ORIGIN: "", AUTH_SECRET: undefined })).toThrow(
    expect.objectContaining({
      kind: "BadSettings",
      payload: { part: "auth", keys: ["PUBLIC_ORIGIN", "AUTH_SECRET"] },
    }),
  );
  expect(() =>
    on.capsules({ PUBLIC_ORIGIN: "ftp://shop.example", AUTH_SECRET: "s".repeat(31) }),
  ).toThrow(
    expect.objectContaining({ payload: { part: "auth", keys: ["PUBLIC_ORIGIN", "AUTH_SECRET"] } }),
  );
});

test("with auth on, the app root does not start without the auth settings", () => {
  /** An install list that never filled the key: the type refuses it, so this reads the runtime. */
  const unfilled: Capsule.Binding = authStartup;
  let error: unknown;
  try {
    createScope({ capsules: [unfilled] });
  } catch (thrown) {
    error = thrown;
  }

  if (!isError(error, "MissingConfig")) throw error;
  expect(error.payload).toEqual({ label: "auth", key: "settings" });
});

test("with auth on and good keys, the app root starts with them read", async () => {
  const root = createScope({ capsules: [authStartup({ settings })] });
  await root.ready;
  expect(root.resolve(authSettings).origin).toBe("https://shop.example");
  expect(root.capsules.map(({ label }) => label)).toEqual(["auth"]);
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("with auth off, the app root reads no auth key", async () => {
  const root = createScope({ capsules: off.capsules({}) });
  await root.ready;
  expect(off.capsules({ AUTH_SECRET: "short" })).toEqual([]);
  expect(root.capsules).toEqual([]);
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("the auth part's work shows on the trace as handleAuth; its settings are a tag", async () => {
  const root = createScope({ observe: { history: 20 }, capsules: [authStartup({ settings })] });
  await root.ready;
  await root.settle(handleAuth, { input: new Request("http://app/api/auth/get-session") });
  expect(root.spans().map(({ name }) => name)).toEqual(["test.auth", "handleAuth"]);
  expect((await root.close({ graceful: true })).status).toBe("success");
});
