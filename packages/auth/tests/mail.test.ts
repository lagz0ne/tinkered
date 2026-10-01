import { serve } from "@hono/node-server";
import { createScope, operation, resource, tag, type Scope, type Operation } from "@tinker/core";
import { createQueryLogger, openTransaction } from "@tinker/drizzle";
import { hono, route } from "@tinker/hono";
import { jobs, type Jobs } from "@tinker/jobs";
import { createJobsClock } from "@tinker/jobs/testing";
import { mail } from "@tinker/mail";
import { createMailMock } from "@tinker/mail/testing";
import { createTestDatabase, type TestDatabase } from "@tinker/stack";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vite-plus/test";
import { auth, authTemplates } from "../src/index.ts";
import * as schema from "./fixture/schema.ts";

const config = tag<PGlite>({ label: "auth.mail.database" });
const database = resource({
  label: "auth.mail.db",
  target: "namespace",
  depends: { client: config },
  factory: async ({ client }, ctx) => {
    const { drizzle } = await import("drizzle-orm/pglite");
    return drizzle({ client, relations: schema.authRelations, logger: createQueryLogger(ctx) });
  },
});
const transaction = resource({
  label: "auth.mail.tx",
  target: "session",
  depends: { db: database },
  factory: ({ db }, ctx) => openTransaction(db, ctx),
});
const postOffice = mail(authTemplates, { env: {}, from: "team@example.com" });
const queue = jobs([postOffice.job], { pglite: database, tx: transaction, env: {} });
/** Auth owns its transaction. This insert borrows its database after commit. */
const sendAuthJob = operation({
  label: "auth.mail.job",
  depends: { queue: queue.extension, db: database },
  run: ({ queue, db }, ctx: Operation.Ctx<Jobs.Input>) => queue.send(ctx.input, db),
});
const identity = auth(database, schema, { sendMail: postOffice.sendMail(sendAuthJob) });
const settings = {
  BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "http://auth.example.test",
};
const person = { name: "Ada", email: "ada@example.com", password: "test-password-123" };
const hold = tag<{ entered: () => void; release: Promise<void> }>({ label: "auth.mail.hold" });
const holdRequest = operation({
  label: "hold request",
  depends: { tx: transaction, hold },
  run: async ({ hold }) => {
    hold.entered();
    await hold.release;
  },
});
let template: TestDatabase.Handle;
let client: PGlite;
let scope: Scope.Handle;
let url: string;
let clock: Awaited<ReturnType<typeof createJobsClock>>;
let mock: ReturnType<typeof createMailMock>;
let entered: boolean;
let release: () => void;

beforeAll(async () => {
  template = await createTestDatabase({
    migrationsFolder: new URL("fixture/drizzle", import.meta.url).pathname,
  });
});
afterAll(async () => {
  await template.close();
});
afterEach(async () => {
  release();
  await scope.close({ graceful: true });
  await client.close();
});
beforeEach(async () => {
  entered = false;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  client = await template.clone();
  clock = await createJobsClock("2030-01-01T00:00:00Z");
  mock = createMailMock(postOffice.backend);
  const web = hono([route.get("/hold", holdRequest)], {
    ...identity.wiring,
    serve: (app) =>
      new Promise((resolve) => {
        const listener = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (address) => {
          url = `http://127.0.0.1:${address.port}`;
          resolve(
            () =>
              new Promise<void>((done, fail) => {
                listener.close((error) => (error ? fail(error) : done()));
              }),
          );
        });
      }),
  }).extension;
  scope = createScope({
    tags: [
      config(client),
      identity.config(settings),
      mock.binding,
      clock.binding,
      hold({
        entered: () => {
          entered = true;
        },
        release: gate,
      }),
    ],
    extensions: [postOffice.extension, queue.extension, identity.extension, web],
  });
  await scope.ready;
});

function post(path: string, body: object = person) {
  return fetch(`${url}/api/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: settings.BETTER_AUTH_URL },
    body: JSON.stringify(body),
  });
}

async function deliver(count: number) {
  await clock.advance(1000);
  await expect
    .poll(
      async () =>
        (await client.query<{ state: string }>("select state from pgboss.job order by created_on"))
          .rows,
    )
    .toEqual(Array.from({ length: count }, () => ({ state: "completed" })));
  return mock.sent();
}

function readLink(html: string | undefined) {
  const match = html?.match(/href="([^"]+)"/);
  if (!match) return expect.unreachable("mail needs a link");
  return new URL(match[1].replaceAll("&amp;", "&"));
}

test("sign-up sends one verify mail whose link verifies the email", async () => {
  expect((await post("sign-up/email")).status).toBe(200);
  const sent = await deliver(1);
  expect(sent).toEqual([
    {
      from: "team@example.com",
      to: [person.email],
      subject: "Verify your email",
      html: expect.stringContaining("Verify email"),
      text: expect.stringContaining("Verify your email address."),
    },
  ]);
  const link = readLink(sent[0].html);
  expect(link.origin).toBe(settings.BETTER_AUTH_URL);
  expect((await fetch(`${url}${link.pathname}${link.search}`, { redirect: "manual" })).status).toBe(
    302,
  );
  const signIn = await post("sign-in/email");
  const cookie = signIn.headers
    .getSetCookie()
    .map((value) => value.split(";").at(0))
    .join("; ");
  const session = await fetch(`${url}/api/auth/get-session`, { headers: { cookie } });
  expect(await session.json()).toMatchObject({
    user: { email: person.email, emailVerified: true },
  });
});

test("a reset mail link changes the password and rejects the old password", async () => {
  await post("sign-up/email");
  await deliver(1);
  expect(
    (
      await post("request-password-reset", {
        email: person.email,
        redirectTo: `${settings.BETTER_AUTH_URL}/new-password`,
      })
    ).status,
  ).toBe(200);
  const sent = await deliver(2);
  expect(sent[1]).toEqual({
    from: "team@example.com",
    to: [person.email],
    subject: "Reset your password",
    html: expect.stringContaining("Reset password"),
    text: expect.stringContaining("Choose a new password."),
  });
  const link = readLink(sent[1].html);
  expect(link.origin).toBe(settings.BETTER_AUTH_URL);
  const response = await fetch(`${url}${link.pathname}${link.search}`, { redirect: "manual" });
  expect(response.status).toBe(302);
  const redirect = new URL(response.headers.get("location")!);
  const password = "new-test-password-456";
  expect(
    (
      await post("reset-password", {
        token: redirect.searchParams.get("token"),
        newPassword: password,
      })
    ).status,
  ).toBe(200);
  expect((await post("sign-in/email", { email: person.email, password })).status).toBe(200);
  expect((await post("sign-in/email", person)).status).toBe(401);
});

test("a duplicate sign-up sends no extra mail", async () => {
  await post("sign-up/email");
  await deliver(1);
  expect((await post("sign-up/email")).status).toBe(422);
  await deliver(1);
  expect(mock.sent()).toHaveLength(1);
});

test("a sign-up that fails after its mail hook sends no mail", async () => {
  await client.exec(`
    create function auth.reject_session() returns trigger language plpgsql as $$
    begin raise exception 'session insert failed'; end $$;
    create trigger reject_session before insert on auth.session
    for each row execute function auth.reject_session();
  `);
  expect((await post("sign-up/email")).status).toBe(500);
  await deliver(0);
  expect(mock.sent()).toEqual([]);
});

test("auth mails and due jobs take turns with a request on PGlite", async () => {
  await post("sign-up/email");
  const request = fetch(`${url}/hold`);
  let signup: Promise<Response> | undefined;
  let reset: Promise<Response> | undefined;
  let polling: Promise<void> | undefined;
  try {
    await expect.poll(() => entered).toBe(true);
    polling = clock.advance(1000);
    signup = post("sign-up/email", { ...person, email: "grace@example.com" });
    reset = post("request-password-reset", { email: person.email });
  } finally {
    release();
  }
  expect((await request).status).toBe(200);
  expect((await signup)?.status).toBe(200);
  expect((await reset)?.status).toBe(200);
  await polling;
  await clock.advance(1000);
  await deliver(3);
  expect(
    mock
      .sent()
      .flatMap(({ to }) => to)
      .sort(),
  ).toEqual([person.email, person.email, "grace@example.com"]);
});
