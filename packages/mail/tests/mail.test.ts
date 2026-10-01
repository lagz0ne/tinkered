import { createScope, operation, type Observe } from "@tinker/core";
import { errorResponses, hono, route } from "@tinker/hono";
import { expect, test } from "vite-plus/test";
import { fixture, input, readStates, scopes } from "./fixtures.ts";

test("a committed request sends one mail rendered from its template", async () => {
  const { client, clock, mock, sendMail, tags, extensions } = await fixture();
  const add = operation({
    label: "welcome",
    depends: { sendMail },
    run: ({ sendMail }) => sendMail.run({ input }),
  });
  const web = hono([route.post("/", add)]).extension;
  const scope = createScope({ tags, extensions: [...extensions, web] });
  scopes.push(scope);
  await scope.ready;
  const response = await scope.resolve(web).request("/", { method: "POST" });
  expect(response.status).toBe(200);
  expect(mock.sent()).toEqual([]);
  await clock.advance(1000);
  await expect.poll(() => readStates(client)).toEqual([{ state: "completed", retry_count: 0 }]);
  await clock.advance(2000);
  expect(mock.sent()).toEqual([
    {
      from: "team@example.com",
      to: ["ada@example.com"],
      subject: "Welcome",
      html: expect.stringContaining("Hello Ada!"),
      text: "Hello Ada!",
    },
  ]);
});

test("a throwing request sends no mail", async () => {
  const { client, mock, clock, sendMail, tags, extensions } = await fixture();
  const addThenFail = operation({
    label: "welcome then fail",
    depends: { sendMail },
    run: async ({ sendMail }) => {
      await sendMail.run({ input });
      throw new Error("request failed");
    },
  });
  const web = hono([route.post("/", addThenFail)]).extension;
  const scope = createScope({ tags, extensions: [...extensions, web] });
  scopes.push(scope);
  await scope.ready;
  const response = await scope.resolve(web).request("/", { method: "POST" });
  expect(response.status).toBe(500);
  await clock.advance(1000);
  expect(await readStates(client)).toEqual([]);
  expect(mock.sent()).toEqual([]);
});

test("a raised error mapped to 409 sends no mail", async () => {
  const { client, clock, mock, sendMail, tags, extensions } = await fixture();
  const addThenRaise = operation({
    label: "welcome then raise",
    depends: { sendMail },
    run: async ({ sendMail }, { raise }) => {
      await sendMail.run({ input });
      raise("Conflict", {});
    },
  });
  const web = hono([route.post("/", addThenRaise)], {
    onError: errorResponses({ Conflict: 409 }),
  }).extension;
  const scope = createScope({ tags, extensions: [...extensions, web] });
  scopes.push(scope);
  await scope.ready;
  const response = await scope.resolve(web).request("/", { method: "POST" });
  expect(response.status).toBe(409);
  await clock.advance(1000);
  expect(await readStates(client)).toEqual([]);
  expect(mock.sent()).toEqual([]);
});

test("a retryable delivery failure retries then sends", async () => {
  const { client, clock, mock, sendMail, tags, extensions } = await fixture();
  const logs: Observe.Log[] = [];
  mock.failNext(["temporary failure"], true);
  const scope = createScope({ tags, extensions, observe: { log: (log) => logs.push(log) } });
  scopes.push(scope);
  await scope.ready;
  await scope.session((s) => s.run(sendMail, { input }));
  await clock.advance(1000);
  await expect.poll(() => readStates(client)).toEqual([{ state: "completed", retry_count: 1 }]);
  expect(mock.sent()).toHaveLength(2);
  expect(logs.filter((log) => log.level === 50)).toEqual([]);
});

test("a permanent delivery failure fails once and logs one line", async () => {
  const { client, clock, mock, sendMail, tags, extensions } = await fixture();
  const logs: Observe.Log[] = [];
  mock.failNext(["recipient rejected"], false);
  const scope = createScope({ tags, extensions, observe: { log: (log) => logs.push(log) } });
  scopes.push(scope);
  await scope.ready;
  const id = await scope.session((s) => s.run(sendMail, { input }));
  await clock.advance(1000);
  await expect.poll(() => readStates(client)).toEqual([{ state: "failed", retry_count: 0 }]);
  await clock.advance(5000);
  expect(mock.sent()).toHaveLength(1);
  expect(logs.filter((log) => log.level === 50)).toMatchObject([
    {
      message: "job failed",
      attributes: {
        queue: "mail",
        id,
        error: { payload: { cause: { errors: ["recipient rejected"] } } },
      },
    },
  ]);
});

test("the log backend writes one line per mail", async () => {
  const { client, clock, sendMail, tags, extensions } = await fixture("log");
  const logs: Observe.Log[] = [];
  const scope = createScope({ tags, extensions, observe: { log: (log) => logs.push(log) } });
  scopes.push(scope);
  await scope.ready;
  await scope.session((s) => s.run(sendMail, { input }));
  await clock.advance(1000);
  await expect.poll(() => readStates(client)).toEqual([{ state: "completed", retry_count: 0 }]);
  expect(logs.filter((log) => log.message === "mail sent")).toMatchObject([
    { level: 30, attributes: { to: "ada@example.com", subject: "Welcome", text: "Hello Ada!" } },
  ]);
});

test("an open request adds mail while due jobs wait for PGlite", async () => {
  const { client, clock, mock, sendMail, tags, extensions } = await fixture();
  const scope = createScope({ tags, extensions });
  scopes.push(scope);
  await scope.ready;
  await scope.session((s) => s.run(sendMail, { input }));
  const request = scope.createSession();
  await request.run(sendMail, {
    input: { ...input, from: "other@example.com", subject: "Second" },
  });
  const polling = clock.advance(1000);
  await request.run(sendMail, { input: { ...input, subject: "Third" } });
  await request.close({ graceful: true });
  await polling;
  for (let batch = 0; batch < 3; batch++) await clock.advance(1000);
  await expect
    .poll(() => readStates(client))
    .toEqual(Array.from({ length: 3 }, () => ({ state: "completed", retry_count: 0 })));
  expect(mock.sent().map(({ from, subject }) => ({ from, subject }))).toEqual([
    { from: "team@example.com", subject: "Welcome" },
    { from: "other@example.com", subject: "Second" },
    { from: "team@example.com", subject: "Third" },
  ]);
});
