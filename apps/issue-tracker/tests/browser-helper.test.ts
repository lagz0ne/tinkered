import { strict as assert } from "node:assert";
import { expect, test } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { preset, type Operation, type Scope } from "@tinker/core";
import { claudeCode } from "@tinker/harness";
import { createApp, createIssue, publishIssues, readDetail, type AppConfig } from "../src/index.ts";
import { readDraftServer, reservePort } from "./draft-server.ts";
import { readFile } from "node:fs/promises";

const APP = process.cwd();

function rowFor(page: Page, title: string) {
  return page.getByRole("list", { name: "issues" }).getByRole("button", {
    name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  });
}

async function selectIssue(page: Page, title: string): Promise<void> {
  const row = rowFor(page, title).first();
  await row.waitFor();
  const pressed = await row.getAttribute("aria-current");
  if (pressed !== "true") await row.click();
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
}

async function boot(
  config: Omit<AppConfig, "dataPath"> & { readonly dataPath?: string },
): Promise<Awaited<ReturnType<typeof createApp>>> {
  return createApp({ ...config });
}

function via<T, I>(scope: Scope.Handle, op: Operation.Handle<T, I>, input: I) {
  return scope.session((s) => s.run(op, { input }));
}

async function mountAssets(app: Awaited<ReturnType<typeof createApp>>["app"]): Promise<void> {
  const assets = join(APP, "dist", "client");
  app.get("/", async (c) => c.html(await readFile(join(assets, "index.html"), "utf8")));
  app.get("/assets/:name", async (c) => {
    const name = c.req.param("name");
    assert.ok(name.includes("/") === false && name.includes("..") === false);
    const body = await readFile(join(assets, "assets", name));
    const type = name.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : "text/css; charset=utf-8";
    return new Response(body, { headers: { "content-type": type } });
  });
}

test("cancelling a held draft keeps partial text and saves nothing", async () => {
  const browser = await chromium.launch();
  const pageErrors: string[] = [];
  const heard = await reservePort();
  const fixture = readDraftServer([{ text: "Cancellable held draft text.", hold: true }]);
  const booted = await boot({
    dataPath: undefined,
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  const app = booted.app;
  await mountAssets(app);
  heard.serve(app);
  const created = await via(booted.scope, createIssue, {
    title: "Draft cancel",
    description: "v1",
  });
  await booted.scope.run(publishIssues);
  fixture.fillIds(created.id);
  const before = await booted.scope.run(readDetail, { input: created.id });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    await page.goto(heard.base);
    await page.getByRole("heading", { name: "Issues" }).waitFor();
    await selectIssue(page, created.title);
    const draft = page.getByRole("region", { name: "triage draft", exact: true });
    await draft.getByRole("button", { name: "Draft a summary", exact: true }).click();
    await fixture.started();
    await draft.getByText("Cancellable he").waitFor();
    await draft.getByRole("button", { name: "Cancel draft", exact: true }).click();
    await draft.getByText("Cancelled.").waitFor();
    await draft.getByText("Cancellable he").waitFor();
    await fixture.aborted();
    assert.deepEqual(await booted.scope.run(readDetail, { input: created.id }), before);
  } finally {
    fixture.release();
    await page.close();
    await browser.close();
    await booted.scope.close();
    await heard.stop();
  }
  expect(pageErrors).toEqual([]);
});

test("posting a draft saves one comment and one activity", async () => {
  const browser = await chromium.launch();
  const pageErrors: string[] = [];
  const heard = await reservePort();
  const fixture = readDraftServer([{ text: "Posted draft text." }]);
  const booted = await boot({
    dataPath: undefined,
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  const app = booted.app;
  await mountAssets(app);
  heard.serve(app);
  const created = await via(booted.scope, createIssue, { title: "Draft post", description: "v1" });
  await booted.scope.run(publishIssues);
  fixture.fillIds(created.id);
  const before = await booted.scope.run(readDetail, { input: created.id });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    await page.goto(heard.base);
    await page.getByRole("heading", { name: "Issues" }).waitFor();
    await selectIssue(page, created.title);
    const draft = page.getByRole("region", { name: "triage draft", exact: true });
    await draft.getByRole("button", { name: "Draft a summary", exact: true }).click();
    await draft.getByText("Posted draft text.").waitFor();
    await draft.getByLabel("Author").selectOption("Lin");
    await draft.getByRole("button", { name: "Post draft", exact: true }).click();
    await draft.getByRole("button", { name: "Draft a summary", exact: true }).waitFor();
    const after = await booted.scope.run(readDetail, { input: created.id });
    assert.equal(after.comments.length, before.comments.length + 1);
    assert.equal(after.comments.at(-1)?.text, "Posted draft text.");
    assert.equal(after.comments.at(-1)?.author, "Lin");
    assert.equal(after.activity.length, before.activity.length + 1);
    assert.equal(fixture.turnCount(), 1);
  } finally {
    fixture.release();
    await page.close();
    await browser.close();
    await booted.scope.close();
    await heard.stop();
  }
  expect(pageErrors).toEqual([]);
});

test("closing the issue view cancels the held draft turn", async () => {
  const browser = await chromium.launch();
  const pageErrors: string[] = [];
  const heard = await reservePort();
  const fixture = readDraftServer([{ text: "Held close draft text here.", hold: true }]);
  const booted = await boot({
    dataPath: undefined,
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  const app = booted.app;
  await mountAssets(app);
  heard.serve(app);
  const created = await via(booted.scope, createIssue, { title: "Draft close", description: "v1" });
  await booted.scope.run(publishIssues);
  fixture.fillIds(created.id);
  const before = await booted.scope.run(readDetail, { input: created.id });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    await page.goto(heard.base);
    await page.getByRole("heading", { name: "Issues" }).waitFor();
    await selectIssue(page, created.title);
    const draft = page.getByRole("region", { name: "triage draft", exact: true });
    await draft.getByRole("button", { name: "Draft a summary", exact: true }).click();
    await fixture.started();
    await draft.getByText("Held close dra").waitFor();
    await rowFor(page, created.title).first().click();
    await fixture.aborted();
    assert.deepEqual(await booted.scope.run(readDetail, { input: created.id }), before);
  } finally {
    fixture.release();
    await page.close();
    await browser.close();
    await booted.scope.close();
    await heard.stop();
  }
  expect(pageErrors).toEqual([]);
});

test("discarding a ready draft clears it and saves nothing", async () => {
  const browser = await chromium.launch();
  const pageErrors: string[] = [];
  const heard = await reservePort();
  const fixture = readDraftServer([{ text: "Discarded draft text." }]);
  const booted = await boot({
    dataPath: undefined,
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  const app = booted.app;
  await mountAssets(app);
  heard.serve(app);
  const created = await via(booted.scope, createIssue, {
    title: "Draft discard",
    description: "v1",
  });
  await booted.scope.run(publishIssues);
  fixture.fillIds(created.id);
  const before = await booted.scope.run(readDetail, { input: created.id });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    await page.goto(heard.base);
    await page.getByRole("heading", { name: "Issues" }).waitFor();
    await selectIssue(page, created.title);
    const draft = page.getByRole("region", { name: "triage draft", exact: true });
    await draft.getByRole("button", { name: "Draft a summary", exact: true }).click();
    await draft.getByText("Discarded draft text.").waitFor();
    await draft.getByRole("button", { name: "Discard draft", exact: true }).click();
    await draft.getByRole("button", { name: "Draft a summary", exact: true }).waitFor();
    assert.deepEqual(await booted.scope.run(readDetail, { input: created.id }), before);
    assert.equal(fixture.turnCount(), 1);
  } finally {
    fixture.release();
    await page.close();
    await browser.close();
    await booted.scope.close();
    await heard.stop();
  }
  expect(pageErrors).toEqual([]);
});

test("a held draft post disables posting controls then saves once", async () => {
  const browser = await chromium.launch();
  const pageErrors: string[] = [];
  const heard = await reservePort();
  const fixture = readDraftServer([{ text: "Held post draft text." }]);
  const booted = await boot({
    dataPath: undefined,
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  const app = booted.app;
  await mountAssets(app);
  let releaseComment: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseComment = resolve;
  });
  const inner = app.fetch.bind(app);
  heard.serve({
    fetch: (req) => {
      if (req.method === "POST" && new URL(req.url).pathname.endsWith("/comments")) {
        return gate.then(() => inner(req));
      }
      return inner(req);
    },
  });
  const created = await via(booted.scope, createIssue, { title: "Held post", description: "v1" });
  await booted.scope.run(publishIssues);
  fixture.fillIds(created.id);
  const before = await booted.scope.run(readDetail, { input: created.id });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    await page.goto(heard.base);
    await page.getByRole("heading", { name: "Issues" }).waitFor();
    await selectIssue(page, created.title);
    const draft = page.getByRole("region", { name: "triage draft", exact: true });
    await draft.getByRole("button", { name: "Draft a summary", exact: true }).click();
    await draft.getByText("Held post draft text.").waitFor();
    const heldComment = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/comments"),
    );
    await draft.getByRole("button", { name: "Post draft", exact: true }).click();
    await heldComment;
    await draft.getByRole("button", { name: /^Posting/ }).waitFor();
    const posting = draft.getByRole("button", { name: /^Posting/ });
    const discarding = draft.getByRole("button", { name: "Discard draft", exact: true });
    assert.equal(await posting.isEnabled(), false);
    assert.equal(await discarding.isEnabled(), false);
    assert.deepEqual(await booted.scope.run(readDetail, { input: created.id }), before);
    releaseComment();
    await draft.getByRole("button", { name: "Draft a summary", exact: true }).waitFor();
    const after = await booted.scope.run(readDetail, { input: created.id });
    assert.equal(after.comments.length, before.comments.length + 1);
    assert.equal(after.comments.at(-1)?.text, "Held post draft text.");
    assert.equal(after.activity.length, before.activity.length + 1);
    assert.equal(fixture.turnCount(), 1);
  } finally {
    releaseComment();
    fixture.release();
    await page.close();
    await browser.close();
    await booted.scope.close();
    await heard.stop();
  }
  expect(pageErrors).toEqual([]);
});

test("a broken draft frame shows a plain notice and saves nothing", async () => {
  const browser = await chromium.launch();
  const pageErrors: string[] = [];
  const heard = await reservePort();
  const fixture = readDraftServer([{ text: "Broken in transit.", hold: true }]);
  const booted = await boot({
    dataPath: undefined,
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  const app = booted.app;
  await mountAssets(app);
  const encoder = new TextEncoder();
  const plain = { fetch: (req: Request) => app.fetch(req) };
  heard.serve({
    fetch: (req) => {
      if (new URL(req.url).pathname.endsWith("/draft") === false || req.method !== "POST") {
        return plain.fetch(req);
      }
      return (async () => {
        const res = await plain.fetch(req);
        if (res.body === null) return res;
        const broken = res.body.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              const text = new TextDecoder().decode(chunk);
              if (text.includes('"kind":"text"')) {
                controller.enqueue(encoder.encode("data: {broken JSON\n\n"));
              } else {
                controller.enqueue(chunk);
              }
            },
          }),
        );
        return new Response(broken, { status: res.status, headers: res.headers });
      })();
    },
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    const created = await via(booted.scope, createIssue, {
      title: "Broken draft",
      description: "v1",
    });
    await booted.scope.run(publishIssues);
    fixture.fillIds(created.id);
    const before = await booted.scope.run(readDetail, { input: created.id });
    await page.goto(heard.base);
    await page.getByRole("heading", { name: "Issues" }).waitFor();
    await selectIssue(page, created.title);
    const draft = page.getByRole("region", { name: "triage draft", exact: true });
    await draft.getByRole("button", { name: "Draft a summary", exact: true }).click();
    await fixture.started();
    await draft.getByRole("alert").waitFor({ timeout: 5000 });
    const notice = await draft.getByRole("alert").innerText();
    assert.match(notice, /unreadable|failed/i);
    await fixture.aborted();
    assert.deepEqual(await booted.scope.run(readDetail, { input: created.id }), before);
    assert.equal(await draft.getByRole("button", { name: "Post draft", exact: true }).count(), 0);
  } finally {
    fixture.release();
    await page.close();
    await browser.close();
    await booted.scope.close();
    await heard.stop();
  }
  expect(pageErrors).toEqual([]);
});

test("shutdown with a live wire and held turn joins cleanly", async () => {
  const heard = await reservePort();
  const fixture = readDraftServer([{ text: "Never finishes.", hold: true }]);
  const path = join(mkdtempSync(join(tmpdir(), "tracker-t05-shutdown-")), "db");
  const live = await boot({
    dataPath: path,
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(live.app);
  const created = await via(live.scope, createIssue, {
    title: "Held shutdown",
    description: "live wire",
  });
  await live.scope.run(publishIssues);
  fixture.fillIds(created.id);
  const before = await live.scope.run(readDetail, { input: created.id });
  const sse = await fetch(`${heard.base}/sync?client=shutdown-proof`);
  assert.equal(sse.status, 200);
  const held = (async () => {
    try {
      const res = await fetch(`${heard.base}/api/issues/${created.id}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      return { text: await res.text() };
    } catch (error: unknown) {
      return { error };
    }
  })();
  try {
    await fixture.started();
    const closing = live.scope.close();
    await fixture.aborted();
    const closed = await closing;
    assert.deepEqual(closed.teardownErrors ?? [], []);
    assert.equal(closed.status, "cancelled");
    const end = await held;
    if ("text" in end && end.text !== undefined) {
      assert.equal(end.text.includes('"kind":"done"'), false);
    }
    const reopened = await boot({ dataPath: path });
    try {
      assert.deepEqual(await reopened.scope.run(readDetail, { input: created.id }), before);
    } finally {
      await reopened.scope.close({ graceful: true });
    }
  } finally {
    fixture.release();
    try {
      await live.scope.close();
    } finally {
      try {
        await sse.body?.cancel();
      } finally {
        try {
          await heard.stop();
        } finally {
          await held;
          rmSync(join(path, ".."), { recursive: true, force: true });
        }
      }
    }
  }
});
