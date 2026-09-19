import { strict as assert } from "node:assert";
import { expect, test } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { preset } from "@tinker/core";
import { claudeCode } from "@tinker/harness";
import { bootScope, buildApp } from "../src/index.ts";
import { readDraftServer, reservePort } from "./draft-server.ts";
import { readFile } from "node:fs/promises";

const APP = process.cwd();

function escapeName(title: string): string {
  return title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rowFor(page: Page, title: string) {
  return page.getByRole("list", { name: "issues" }).getByRole("button", {
    name: new RegExp(escapeName(title)),
  });
}

async function selectIssue(page: Page, title: string): Promise<void> {
  const row = rowFor(page, title).first();
  await row.waitFor();
  const pressed = await row.getAttribute("aria-current");
  if (pressed !== "true") await row.click();
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
}

async function deselectIssue(page: Page, title: string): Promise<void> {
  const row = rowFor(page, title).first();
  await row.waitFor();
  const pressed = await row.getAttribute("aria-current");
  if (pressed === "true") await row.click();
  await page.getByText("Select an issue to edit it.").waitFor();
}

function removeTemp(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

async function mountAssets(app: ReturnType<typeof buildApp>): Promise<void> {
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

async function serveClient(
  heard: Awaited<ReturnType<typeof reservePort>>,
  app: ReturnType<typeof buildApp>,
): Promise<void> {
  await mountAssets(app);
  heard.serve(app);
}

test("cancelling a held draft keeps partial text and saves nothing", async () => {
  const browser = await chromium.launch();
  const pageErrors: string[] = [];
  const heard = await reservePort();
  const fixture = readDraftServer([{ text: "Cancellable held draft text.", hold: true }]);
  const booted = await bootScope(undefined, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  const app = buildApp(booted);
  await serveClient(heard, app);
  const created = await booted.save.create({ title: "Draft cancel", description: "v1" });
  fixture.fillIds(created.id);
  const before = await booted.detail(created.id);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    await page.goto(heard.base);
    await page.getByRole("heading", { name: "Issues" }).waitFor();
    await selectIssue(page, created.title);
    const draft = page.getByRole("region", { name: "triage draft", exact: true });
    await draft.getByRole("button", { name: "Draft a summary", exact: true }).click();
    await draft.getByText("Cancellable held").waitFor();
    await draft.getByRole("button", { name: "Cancel draft", exact: true }).click();
    await draft.getByText("Cancelled.").waitFor();
    await draft.getByText("Cancellable held").waitFor();
    await fixture.aborted();
    assert.deepEqual(await booted.detail(created.id), before);
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
  const booted = await bootScope(undefined, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  const app = buildApp(booted);
  await serveClient(heard, app);
  const created = await booted.save.create({ title: "Draft post", description: "v1" });
  fixture.fillIds(created.id);
  const before = await booted.detail(created.id);
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
    const after = await booted.detail(created.id);
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
  const booted = await bootScope(undefined, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  const app = buildApp(booted);
  await serveClient(heard, app);
  const created = await booted.save.create({ title: "Draft close", description: "v1" });
  fixture.fillIds(created.id);
  const before = await booted.detail(created.id);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    await page.goto(heard.base);
    await page.getByRole("heading", { name: "Issues" }).waitFor();
    await selectIssue(page, created.title);
    const draft = page.getByRole("region", { name: "triage draft", exact: true });
    await draft.getByRole("button", { name: "Draft a summary", exact: true }).click();
    await draft.getByText("Held close draft").waitFor();
    await fixture.started();
    await deselectIssue(page, created.title);
    await fixture.aborted();
    assert.deepEqual(await booted.detail(created.id), before);
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
  const booted = await bootScope(undefined, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  const app = buildApp(booted);
  await serveClient(heard, app);
  const created = await booted.save.create({ title: "Draft discard", description: "v1" });
  fixture.fillIds(created.id);
  const before = await booted.detail(created.id);
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
    assert.deepEqual(await booted.detail(created.id), before);
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
  const booted = await bootScope(undefined, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  const app = buildApp(booted);
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
  const created = await booted.save.create({ title: "Held post", description: "v1" });
  fixture.fillIds(created.id);
  const before = await booted.detail(created.id);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    await page.goto(heard.base);
    await page.getByRole("heading", { name: "Issues" }).waitFor();
    await selectIssue(page, created.title);
    const draft = page.getByRole("region", { name: "triage draft", exact: true });
    await draft.getByRole("button", { name: "Draft a summary", exact: true }).click();
    await draft.getByText("Held post draft text.").waitFor();
    const posting = draft.getByRole("button", { name: /Post draft|Posting/ });
    const discarding = draft.getByRole("button", { name: "Discard draft", exact: true });
    await posting.click();
    await draft.getByRole("button", { name: "Posting", exact: true }).waitFor();
    assert.equal(await posting.isEnabled(), false);
    assert.equal(await discarding.isEnabled(), false);
    releaseComment();
    await draft.getByRole("button", { name: "Draft a summary", exact: true }).waitFor();
    const after = await booted.detail(created.id);
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
  const booted = await bootScope(undefined, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  const app = buildApp(booted);
  await mountAssets(app);
  const plain = { fetch: (req: Request) => app.fetch(req) };
  heard.serve({ fetch: (req) => faultDraft(req, plain.fetch) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    const created = await booted.save.create({ title: "Broken draft", description: "v1" });
    fixture.fillIds(created.id);
    const before = await booted.detail(created.id);
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
    assert.deepEqual(await booted.detail(created.id), before);
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
  const live = await bootScope(path, {
    draft: { enabled: true, baseUrl: heard.base },
    presets: [preset(claudeCode.sdk, async () => fixture.sdk)],
  });
  heard.serve(buildApp(live));
  const created = await live.save.create({ title: "Held shutdown", description: "live wire" });
  fixture.fillIds(created.id);
  const before = await live.detail(created.id);
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
    const reopened = await bootScope(path);
    try {
      assert.deepEqual(await reopened.detail(created.id), before);
    } finally {
      await reopened.scope.close({ graceful: true });
    }
  } finally {
    fixture.release();
    await sse.body?.cancel();
    await held.then(
      () => undefined,
      () => undefined,
    );
    await heard.stop();
    await live.scope.close();
    removeTemp(join(path, ".."));
  }
});

function faultDraft(
  req: Request,
  next: (req: Request) => Response | Promise<Response>,
): Response | Promise<Response> {
  if (new URL(req.url).pathname.endsWith("/draft") === false || req.method !== "POST") {
    return next(req);
  }
  const encoder = new TextEncoder();
  return (async () => {
    const res = await next(req);
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
}
