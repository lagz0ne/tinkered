import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vite-plus/test";
import { serve } from "@hono/node-server";
import { createScope, operation, resource, tag, type Scope } from "@tinker/core";
import { createQueryLogger, openTransaction } from "@tinker/drizzle";
import { hono, route, type HonoScope } from "@tinker/hono";
import { createTestDatabase, type TestDatabase } from "@tinker/stack";
import type { PGlite } from "@electric-sql/pglite";
import { auth, isError } from "../src/index.ts";
import * as schema from "./fixture/schema.ts";

const storeConfig = tag<{ client: PGlite }>({ label: "auth.test.store" });
const store = resource({
  label: "auth.test.db",
  target: "namespace",
  depends: { config: storeConfig },
  factory: async ({ config }, ctx) => {
    const { drizzle } = await import("drizzle-orm/pglite");
    return drizzle({
      client: config.client,
      relations: schema.authRelations,
      logger: createQueryLogger(ctx),
    });
  },
});
const transaction = resource({
  label: "auth.test.tx",
  target: "session",
  depends: { db: store },
  factory: ({ db }, ctx) => openTransaction(db, ctx),
});
const identity = auth(store, schema);
const settings = {
  BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "http://auth.example.test",
};
const person = {
  name: "Ada",
  email: "ada@example.com",
  password: "test-password-123",
  image: "https://example.com/ada.png",
};
const hold = tag<{ entered: () => void; release: Promise<void> }>({ label: "test.hold" });
const readUser = operation({
  label: "readUser",
  depends: { user: identity.user },
  run: ({ user }) => user,
});
const visit = operation({
  label: "visit",
  depends: { tx: transaction, readUser, hold: hold.optional },
  run: async ({ tx, readUser, hold }) => {
    if (hold.present) {
      hold.value.entered();
      await hold.value.release;
    }
    const user = readUser.run();
    await tx.insert(schema.visits).values({ name: user?.name ?? "guest" });
    return user;
  },
});
let template: TestDatabase.Handle;
let scope: Scope.Handle;
let client: PGlite;
let url: string;
let arrived: (() => void) | undefined;
let web: Scope.Extension<Parameters<HonoScope.Serve>[0]>;
const scopes: Scope.Handle[] = [];
const clients: PGlite[] = [];
beforeAll(async () => {
  template = await createTestDatabase({
    migrationsFolder: new URL("fixture/drizzle", import.meta.url).pathname,
  });
});
afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.close({ graceful: true });
  for (const client of clients.splice(0)) await client.close();
});
afterAll(async () => {
  await template.close();
});

beforeEach(async () => {
  client = await template.clone();
  clients.push(client);
  url = "";
  arrived = undefined;
  web = hono(
    [
      route.get("/me", visit, {
        respond: (user, c) => c.json(user, { headers: { "Set-Cookie": "app=active; Path=/" } }),
      }),
      route.get("/raw-me", visit, {
        respond: (user, c) => {
          c.header("Set-Cookie", "app=1; Path=/", { append: true });
          c.header("Content-Type", "application/json");
          return new Response(JSON.stringify(user), { headers: c.res.headers });
        },
      }),
    ],
    {
      ...identity.wiring,
      tags: async (c) => {
        c.header("Set-Cookie", "before=kept; Path=/", { append: true });
        arrived?.();
        return identity.wiring.tags?.(c);
      },
      serve: (app) =>
        new Promise((resolve) => {
          const listener = serve(
            { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
            (address) => {
              url = `http://127.0.0.1:${address.port}`;
              resolve(
                () =>
                  new Promise<void>((done, fail) => {
                    listener.close((error) => (error ? fail(error) : done()));
                  }),
              );
            },
          );
        }),
    },
  ).extension;
  scope = createScope({
    tags: [storeConfig({ client }), identity.config(settings)],
    extensions: [web, identity.extension],
  });
  scopes.push(scope);
  await scope.ready;
});

function post(url: string, path: string, body: object = person, cookie = "") {
  return fetch(`${url}/api/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: settings.BETTER_AUTH_URL, cookie },
    body: JSON.stringify(body),
  });
}

async function signIn(url: string) {
  await post(url, "sign-up/email");
  const answer = await post(url, "sign-in/email");
  return answer.headers
    .getSetCookie()
    .map((value) => value.split(";").at(0))
    .join("; ");
}

test("sign up then sign in gives a session cookie accepted by the auth GET route", async () => {
  expect((await post(url, "sign-up/email")).status).toBe(200);
  const answer = await post(url, "sign-in/email");
  expect(answer.status).toBe(200);
  const cookie = answer.headers
    .getSetCookie()
    .map((value) => value.split(";").at(0))
    .join("; ");
  expect(cookie).toContain("better-auth.session_token=");
  const session = await fetch(`${url}/api/auth/get-session`, { headers: { cookie } });
  expect(await session.json()).toMatchObject({ user: { name: "Ada", email: person.email } });
});

test("an app route refreshes a near-expiry session cookie and keeps its own cookies", async () => {
  const cookie = await signIn(url);
  await client.query("update auth.session set expires_at = now() + interval '1 day'");
  const response = await fetch(`${url}/me`, { headers: { cookie } });
  expect(response.headers.getSetCookie()).toEqual(
    expect.arrayContaining([
      expect.stringContaining("better-auth.session_token="),
      "before=kept; Path=/",
      "app=active; Path=/",
    ]),
  );
});

test("a raw response keeps refreshed cookies when it copies the context headers", async () => {
  const cookie = await signIn(url);
  await client.query("update auth.session set expires_at = now() + interval '1 day'");
  const response = await fetch(`${url}/raw-me`, { headers: { cookie } });
  expect(response.headers.getSetCookie()).toEqual(
    expect.arrayContaining([
      expect.stringContaining("better-auth.session_token="),
      "app=1; Path=/",
    ]),
  );
});

test("the auth get-session route refreshes a near-expiry session cookie", async () => {
  const cookie = await signIn(url);
  await client.query("update auth.session set expires_at = now() + interval '1 day'");
  const response = await fetch(`${url}/api/auth/get-session`, { headers: { cookie } });
  expect(response.headers.getSetCookie()).toEqual(
    expect.arrayContaining([expect.stringContaining("better-auth.session_token=")]),
  );
});

test("an operation reads the user after opening its transaction and reads none without a cookie", async () => {
  const cookie = await signIn(url);
  const response = await fetch(`${url}/me`, { headers: { cookie } });
  expect(await response.json()).toEqual({
    id: expect.any(String),
    name: "Ada",
    email: person.email,
    emailVerified: false,
    image: person.image,
  });
  expect(await (await fetch(`${url}/me`)).json()).toBeNull();
  expect((await client.query("select name from visits order by name")).rows).toEqual([
    { name: "Ada" },
    { name: "guest" },
  ]);
});

test("sign out ends the session even when the old cookie is sent again", async () => {
  const cookie = await signIn(url);
  expect((await post(url, "sign-out", {}, cookie)).status).toBe(200);
  expect(await (await fetch(`${url}/me`, { headers: { cookie } })).json()).toBeNull();
});

test("a wrong password keeps Better Auth's status and answer", async () => {
  await post(url, "sign-up/email");
  const answer = await post(url, "sign-in/email", { ...person, password: "wrong-password" });
  expect(answer.status).toBe(401);
  expect(await answer.json()).toEqual({
    code: "INVALID_EMAIL_OR_PASSWORD",
    message: "Invalid email or password",
  });
});

test("sign in and requests take turns with work holding the one database connection", async () => {
  const cookie = await signIn(url);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const work = scope.session((session) =>
    session.run(visit, { tags: [hold({ entered: entered.resolve, release: release.promise })] }),
  );
  await entered.promise;
  const incoming = Promise.withResolvers<void>();
  let reached = 0;
  arrived = () => {
    if (++reached === 2) incoming.resolve();
  };
  const login = post(url, "sign-in/email");
  const request = fetch(`${url}/me`, { headers: { cookie } });
  await incoming.promise;
  release.resolve();
  const [signedIn, read] = await Promise.all([login, request, work]);
  expect(signedIn.status).toBe(200);
  expect(await read.json()).toMatchObject({ email: person.email });
});

test("a piece rejects a second live root and can restart after its owner closes", async () => {
  const rejected = createScope({
    tags: [identity.config(settings)],
    extensions: [identity.extension],
  });
  try {
    await rejected.ready;
    expect.unreachable();
  } catch (error) {
    if (isError(error, "BadAuthSettings")) throw error;
    if (!isError(error, "PieceInUse")) throw error;
    expect(error.payload).toEqual({ label: "auth" });
  } finally {
    await rejected.close();
  }
  expect((await post(url, "sign-up/email")).status).toBe(200);
  await scope.close({ graceful: true });
  scope = createScope({
    tags: [storeConfig({ client }), identity.config(settings)],
    extensions: [web, identity.extension],
  });
  scopes.push(scope);
  await scope.ready;
  expect((await post(url, "sign-in/email")).status).toBe(200);
});

test("a changed auth secret rejects a cookie from the prior root", async () => {
  const cookie = await signIn(url);
  expect(await (await fetch(`${url}/me`, { headers: { cookie } })).json()).toMatchObject({
    email: person.email,
  });
  await scope.close({ graceful: true });
  scope = createScope({
    tags: [
      storeConfig({ client }),
      identity.config({
        ...settings,
        BETTER_AUTH_SECRET: "a-new-test-only-secret-with-at-least-32-characters",
      }),
    ],
    extensions: [web, identity.extension],
  });
  scopes.push(scope);
  await scope.ready;
  expect(await (await fetch(`${url}/me`, { headers: { cookie } })).json()).toBeNull();
});
