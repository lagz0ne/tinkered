import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright";
import {
  bootScope,
  buildApp,
  fail,
  parseIssue,
  parseIssueDetail,
  parseIssueList,
  type Issues,
} from "../src/index.ts";

type Exit = { readonly code: number | null; readonly signal: NodeJS.Signals | null };
type OwnedServer = { readonly child: ChildProcess; readonly ended: Promise<Exit> };

const APP = process.cwd();

function tempData(): { readonly dir: string; readonly db: string } {
  const dir = mkdtempSync(join(tmpdir(), "tracker-t05-proof-"));
  return { dir, db: join(dir, "db") };
}

function removeTemp(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

async function freePort(): Promise<number> {
  const reserve = createServer();
  await new Promise<void>((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const address = reserve.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  return port;
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  const timer = AbortSignal.timeout(15000);
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer.addEventListener("abort", () => reject(new Error(label)), { once: true });
    }),
  ]);
}

function ownServer(port: number, db: string): OwnedServer {
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/server/main.ts"], {
    cwd: APP,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_PATH: db,
      DRAFT_HELPER: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.resume();
  child.stderr?.resume();
  const ended: Promise<Exit> = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, ended };
}

async function waitOk(base: string, server: OwnedServer): Promise<void> {
  let lastError = "";
  server.child.stderr?.on("data", (chunk) => {
    lastError += String(chunk);
  });
  const deadline = Date.now() + 15000;
  for (;;) {
    if (server.child.exitCode !== null) {
      throw fail("SyncDropped", {
        reason: lastError === "" ? "server exited early" : lastError,
      });
    }
    try {
      if ((await fetch(`${base}/api/issues`)).ok) return;
    } catch {
      await nextTurn();
    }
    if (Date.now() > deadline) throw fail("SyncDropped", { reason: "server start timed out" });
    await nextTurn();
  }
}

async function startServer(port: number, db: string): Promise<OwnedServer> {
  const server = ownServer(port, db);
  try {
    await waitOk(`http://127.0.0.1:${port}`, server);
  } catch (error: unknown) {
    server.child.kill("SIGTERM");
    await bounded(server.ended, "failed start cleanup timed out");
    throw error;
  }
  return server;
}

async function stopServer(server: OwnedServer): Promise<void> {
  server.child.kill("SIGTERM");
  const outcome = await bounded(server.ended, "server stop timed out");
  assert.equal(outcome.code, 0);
}

async function stopServerOrKill(server: OwnedServer): Promise<void> {
  server.child.kill("SIGTERM");
  const outcome = await bounded(server.ended, "cleanup timed out").catch(() => {
    server.child.kill("SIGKILL");
    return server.ended;
  });
  assert.equal(outcome.code, 0);
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function readDetail(base: string, id: string): Promise<Issues.Detail> {
  const res = await fetch(`${base}/api/issues/${id}`);
  assert.equal(res.status, 200);
  return parseIssueDetail(await readJson(res));
}

async function readList(base: string): Promise<readonly Issues.Issue[]> {
  const res = await fetch(`${base}/api/issues`);
  assert.equal(res.status, 200);
  return parseIssueList(await readJson(res));
}

function runTools(
  base: string,
  argv: readonly string[],
): Promise<Exit & { out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "src/tools/main.ts", ...argv],
      { cwd: APP, env: { ...process.env, BASE_URL: base }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      err += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, out, err }));
  });
}

async function openIssue(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: title, exact: true }).click();
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
}

async function main(): Promise<void> {
  const { dir, db } = tempData();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let first: OwnedServer | undefined;
  let second: OwnedServer | undefined;
  let browser: Browser | undefined;
  let firstPage: Page | undefined;
  let secondPage: Page | undefined;
  let closed = false;
  const pageErrors: string[] = [];
  async function cleanup(): Promise<void> {
    if (closed) return;
    closed = true;
    const failures: string[] = [];
    if (firstPage !== undefined) {
      await firstPage.close().catch((error: unknown) => failures.push(String(error)));
      firstPage = undefined;
    }
    if (secondPage !== undefined) {
      await secondPage.close().catch((error: unknown) => failures.push(String(error)));
      secondPage = undefined;
    }
    if (browser !== undefined) {
      await browser.close().catch((error: unknown) => failures.push(String(error)));
      browser = undefined;
    }
    if (first !== undefined) {
      await stopServerOrKill(first).catch((error: unknown) => failures.push(String(error)));
      first = undefined;
    }
    if (second !== undefined) {
      await stopServerOrKill(second).catch((error: unknown) => failures.push(String(error)));
      second = undefined;
    }
    removeTemp(dir);
    assert.deepEqual(failures, []);
  }
  try {
    first = await startServer(port, db);
    browser = await chromium.launch();
    firstPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    secondPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const firstTab = firstPage;
    const secondTab = secondPage;
    firstTab.on("pageerror", (error) => pageErrors.push(String(error)));
    secondTab.on("pageerror", (error) => pageErrors.push(String(error)));
    await firstTab.goto(base);
    await secondTab.goto(base);
    await firstTab.getByRole("heading", { name: "Issues" }).waitFor();
    await secondTab.getByRole("heading", { name: "Issues" }).waitFor();

    const title = `T05 browser proof ${Date.now()}`;
    await firstTab.keyboard.press("Tab");
    await firstTab.getByLabel("Title").fill(title);
    await firstTab.getByLabel("Description").fill("saved once, seen twice");
    await firstTab.getByRole("button", { name: "Create issue" }).click();
    await firstTab.getByRole("button", { name: title, exact: true }).waitFor();
    await secondTab.getByRole("button", { name: title, exact: true }).waitFor();

    await openIssue(firstTab, title);
    const edit = firstTab.getByRole("form", { name: "edit issue" });
    const savedRevisionText = await firstTab
      .getByRole("button", { name: /Save \(rev/ })
      .innerText();
    assert.match(savedRevisionText, /Save \(rev 0\)/);
    await edit.getByLabel("Status").selectOption("in_progress");
    await edit.getByLabel("Assignee").selectOption("Ada");
    await firstTab.getByRole("button", { name: /Save \(rev/ }).click();
    const firstDetail = firstTab.getByRole("region", { name: "issue detail" });
    await firstDetail.getByText("In progress · Ada").waitFor();
    const listed = await readList(base);
    const saved = listed.find((issue) => issue.title === title);
    assert.ok(saved !== undefined);
    const id = saved.id;
    const secondDetail = secondTab.getByRole("region", { name: "issue detail" });
    await openIssue(secondTab, title);
    await secondDetail.getByText("In progress · Ada").waitFor();

    await secondTab.getByRole("textbox", { name: "Comment" }).fill("seen across tabs");
    await secondTab.getByRole("button", { name: "Add comment" }).click();
    await secondDetail.getByText("seen across tabs").waitFor();
    await firstDetail.getByText("seen across tabs").waitFor();

    await firstTab.getByRole("textbox", { name: "Comment" }).fill("draft stays local");
    const secondEdit = secondTab.getByRole("form", { name: "edit issue" });
    await secondEdit.getByLabel("Status").selectOption("done");
    await secondTab.getByRole("button", { name: /Save \(rev/ }).click();
    await secondDetail.getByText("Done · Ada").waitFor();
    await firstDetail.getByText("Done · Ada").waitFor();
    assert.equal(
      await firstTab.getByRole("textbox", { name: "Comment" }).inputValue(),
      "draft stays local",
    );

    const targets = await firstTab
      .locator("button,input,select,textarea")
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    assert.ok(targets.length > 0);
    assert.ok(targets.every((height) => height >= 44));
    assert.equal(
      await firstTab.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );

    await firstTab.reload();
    await firstDetail.getByText("Done · Ada").waitFor();
    await openIssue(firstTab, title);
    await openIssue(secondTab, title);
    const afterReload = await readDetail(base, id);
    assert.equal(afterReload.issue.status, "done");
    const conflictTitle = `${title} loser draft`;
    const winnerTitle = `${title} winner`;
    const loserEdit = secondTab.getByRole("form", { name: "edit issue" });
    const winnerEdit = firstTab.getByRole("form", { name: "edit issue" });
    await loserEdit.getByRole("textbox", { name: "Title" }).fill(conflictTitle);
    await winnerEdit.getByRole("textbox", { name: "Title" }).fill(winnerTitle);
    const baseRevision = afterReload.issue.revision;
    await firstTab.getByRole("button", { name: /Save \(rev/ }).click();
    await firstDetail.getByText(winnerTitle).waitFor();
    await secondDetail.getByText(winnerTitle).waitFor();
    const beforeLoser = await readDetail(base, id);
    assert.equal(beforeLoser.issue.title, winnerTitle);
    await secondTab.getByRole("button", { name: /Save \(rev/ }).click();
    await secondTab.getByText("Someone else saved first").waitFor();
    assert.equal(
      await loserEdit.getByRole("textbox", { name: "Title" }).inputValue(),
      conflictTitle,
    );
    assert.deepEqual(await readDetail(base, id), beforeLoser);
    await secondTab.getByRole("button", { name: "Reload their change" }).click();
    await secondDetail.getByText(winnerTitle).waitFor();
    assert.equal(await loserEdit.getByRole("textbox", { name: "Title" }).inputValue(), winnerTitle);

    const created = await runTools(base, [
      "create",
      "--title",
      "CLI saved",
      "--description",
      "via CLI",
    ]);
    assert.equal(created.code, 0);
    const made = parseIssue(JSON.parse(created.out));
    assert.equal(made.title, "CLI saved");
    await firstTab.getByRole("button", { name: "CLI saved", exact: true }).waitFor();
    const updated = await runTools(base, [
      "update",
      made.id,
      "--base-revision",
      String(made.revision),
      "--status",
      "done",
      "--assignee",
      "Sam",
    ]);
    assert.equal(updated.code, 0);
    const moved = parseIssue(JSON.parse(updated.out));
    assert.equal(moved.status, "done");
    await openIssue(firstTab, "CLI saved");
    const cliDetail = firstTab.getByRole("region", { name: "issue detail" });
    await cliDetail.getByText("Done · Sam").waitFor();
    const commented = await runTools(base, [
      "comment",
      made.id,
      "--author",
      "Lin",
      "--text",
      "Shipped",
    ]);
    assert.equal(commented.code, 0);
    await cliDetail.getByText("Shipped").waitFor();
    const shown = await runTools(base, ["get", made.id]);
    assert.equal(shown.code, 0);
    assert.equal(parseIssueDetail(JSON.parse(shown.out)).comments.length, 1);

    const staleCli = await runTools(base, [
      "update",
      made.id,
      "--base-revision",
      "0",
      "--title",
      "Late",
    ]);
    assert.equal(staleCli.code, 1);
    assert.match(staleCli.err, /IssueConflict/);

    const savedBeforeRestart = await readDetail(base, id);
    const running = first as OwnedServer;
    first = undefined;
    await stopServer(running);
    first = await startServer(port, db);
    await firstTab.goto(base);
    await firstTab.getByRole("heading", { name: "Issues" }).waitFor();
    await firstTab.getByRole("button", { name: winnerTitle, exact: true }).waitFor();
    await secondTab.goto(base);
    await secondTab.getByRole("heading", { name: "Issues" }).waitFor();
    await secondTab.getByRole("button", { name: winnerTitle, exact: true }).waitFor();
    assert.deepEqual(await readDetail(base, id), savedBeforeRestart);

    await openIssue(firstTab, winnerTitle);
    const restartEdit = firstTab.getByRole("form", { name: "edit issue" });
    await restartEdit.getByLabel("Title", { exact: true }).fill("My local title");
    await firstTab.getByRole("textbox", { name: "Comment", exact: true }).fill("My local comment");
    const staleRevision = savedBeforeRestart.issue.revision;
    const stopping = first as OwnedServer;
    first = undefined;
    await stopServer(stopping);
    first = await startServer(port, db);
    await firstTab
      .getByRole("alert")
      .filter({ hasText: /live|connect/i })
      .waitFor();
    const changed = await fetch(`${base}/api/issues/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseRevision: staleRevision, title: "Saved after restart" }),
    });
    assert.equal(changed.status, 200);
    const reconnect = firstTab.getByRole("button", { name: /^Reconnect$/i });
    if ((await reconnect.count()) > 0) await reconnect.click();
    await firstTab
      .getByRole("heading", { name: "Saved after restart", exact: true })
      .waitFor({ timeout: 8000 });
    assert.equal(
      await restartEdit.getByLabel("Title", { exact: true }).inputValue(),
      "My local title",
    );
    assert.equal(
      await firstTab.getByRole("textbox", { name: "Comment", exact: true }).inputValue(),
      "My local comment",
    );
    const beforeStale = await readDetail(base, id);
    const reply = firstTab.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" && response.url().endsWith(`/api/issues/${id}`),
    );
    await restartEdit.getByRole("button", { name: /Save/ }).click();
    const rejected = await reply;
    assert.equal(rejected.status(), 409);
    assert.deepEqual(await readDetail(base, id), beforeStale);
    const sent = JSON.parse(String(rejected.request().postData()));
    assert.equal(sent.baseRevision, staleRevision);
    assert.equal(sent.baseRevision, baseRevision);
    await firstTab.getByText("Someone else saved first").waitFor();

    const booted = await bootScope(undefined);
    const app = buildApp(booted);
    const heard = await startHeard(app);
    try {
      await booted.save.create({ title: "Held shutdown", description: "live wire" });
      const browserOnly = await browser.newPage();
      browserOnly.on("pageerror", (error) => pageErrors.push(String(error)));
      await browserOnly.goto(heard.base);
      await browserOnly.getByRole("button", { name: "Held shutdown", exact: true }).waitFor();
      const closing = booted.scope.close();
      await browserOnly.close();
      const closed = await closing;
      assert.deepEqual(closed.teardownErrors ?? [], []);
    } finally {
      await heard.stop();
      await booted.scope.close();
    }

    assert.deepEqual(pageErrors, []);
    await cleanup();
  } catch (error: unknown) {
    await cleanup();
    throw error;
  }
}

async function startHeard(app: {
  fetch: (req: Request) => Response | Promise<Response>;
}): Promise<{ readonly base: string; readonly stop: () => Promise<void> }> {
  const { Server } = await import("node:http");
  const { serve } = await import("@hono/node-server");
  let settle: (port: number) => void = () => undefined;
  const heard = new Promise<number>((resolve) => {
    settle = resolve;
  });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) =>
    settle(info.port),
  );
  const port = await heard;
  return {
    base: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise<void>((resolve) => {
        if (server instanceof Server) server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

await main();
