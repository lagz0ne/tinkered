import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright";
import { fail, parseIssue, parseIssueDetail, parseIssueList, type Issues } from "../src/index.ts";

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

function readTimeout(label: string): Promise<never> {
  const timer = AbortSignal.timeout(15000);
  return new Promise<never>((_resolve, reject) => {
    timer.addEventListener("abort", () => reject(fail("SyncDropped", { reason: label })), {
      once: true,
    });
  });
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([promise, readTimeout(label)]);
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
  const ended: Promise<Exit> = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, ended };
}

function readChildGone(server: OwnedServer): boolean {
  return server.child.exitCode !== null || server.child.signalCode !== null;
}

async function waitPoll(base: string, server: OwnedServer, lastError: string): Promise<boolean> {
  if (readChildGone(server)) throw fail("SyncDropped", { reason: lastError });
  try {
    return (await bounded(fetch(`${base}/api/issues`), "server health timed out")).ok;
  } catch {
    if (readChildGone(server)) throw fail("SyncDropped", { reason: lastError });
    return false;
  }
}

async function waitOk(base: string, server: OwnedServer): Promise<void> {
  let lastError = "";
  server.child.stderr?.on("data", (chunk) => {
    lastError += String(chunk);
  });
  const deadline = Date.now() + 15000;
  for (;;) {
    if (Date.now() > deadline) throw fail("SyncDropped", { reason: "server start timed out" });
    if (await waitPoll(base, server, lastError)) return;
    await nextTurn();
  }
}

async function startServer(port: number, db: string): Promise<OwnedServer> {
  const server = ownServer(port, db);
  try {
    await waitOk(`http://127.0.0.1:${port}`, server);
  } catch (error: unknown) {
    server.child.kill("SIGTERM");
    await bounded(server.ended, "failed start cleanup timed out").catch(() => {
      server.child.kill("SIGKILL");
      return server.ended;
    });
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

function parseEditSent(postData: string | null): number {
  assert.ok(postData !== null);
  const raw: unknown = JSON.parse(postData);
  if (typeof raw !== "object" || raw === null || !("baseRevision" in raw)) {
    throw fail("SyncDropped", { reason: "saved edit did not carry a revision" });
  }
  if (typeof raw.baseRevision !== "number") {
    throw fail("SyncDropped", { reason: "saved edit did not carry a revision" });
  }
  return raw.baseRevision;
}

async function main(): Promise<void> {
  const { dir, db } = tempData();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let server: OwnedServer | undefined;
  let spare: OwnedServer | undefined;
  let browser: Browser | undefined;
  let firstPage: Page | undefined;
  let secondPage: Page | undefined;
  let closed = false;
  const pageErrors: string[] = [];
  async function closePages(failures: string[]): Promise<void> {
    for (const slot of ["first", "second"] as const) {
      const page = slot === "first" ? firstPage : secondPage;
      if (page === undefined) continue;
      if (slot === "first") firstPage = undefined;
      else secondPage = undefined;
      await page.close().catch((error: unknown) => failures.push(String(error)));
    }
  }
  async function closeServers(failures: string[]): Promise<void> {
    for (const slot of ["main", "spare"] as const) {
      const owned = slot === "main" ? server : spare;
      if (owned === undefined) continue;
      await stopServerOrKill(owned).catch((error: unknown) => failures.push(String(error)));
      if (slot === "main" && server === owned) server = undefined;
      if (slot === "spare" && spare === owned) spare = undefined;
    }
  }
  async function cleanup(): Promise<void> {
    if (closed) return;
    closed = true;
    const failures: string[] = [];
    await closePages(failures);
    if (browser !== undefined) {
      const owned = browser;
      browser = undefined;
      await owned.close().catch((error: unknown) => failures.push(String(error)));
    }
    await closeServers(failures);
    removeTemp(dir);
    assert.deepEqual(failures, []);
  }
  async function restart(): Promise<void> {
    if (server === undefined) throw fail("SyncDropped", { reason: "no server to restart" });
    const owned = server;
    await stopServer(owned);
    if (server === owned) server = undefined;
    else throw fail("SyncDropped", { reason: "server owner changed during restart" });
    server = await startServer(port, db);
  }
  try {
    server = await startServer(port, db);
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
    await firstTab.getByLabel("Title").fill(title);
    await firstTab.getByLabel("Description").fill("saved once, seen twice");
    await firstTab.getByRole("button", { name: "Create issue" }).focus();
    await firstTab.keyboard.press("Enter");
    await rowFor(firstTab, title).first().waitFor();
    await rowFor(secondTab, title).first().waitFor();

    await selectIssue(firstTab, title);
    const edit = firstTab.getByRole("form", { name: "edit issue" });
    assert.match(
      await firstTab.getByRole("button", { name: /Save \(rev/ }).innerText(),
      /Save \(rev 0\)/,
    );
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
    await selectIssue(secondTab, title);
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
    await firstTab.getByRole("heading", { name: "Issues" }).waitFor();
    await rowFor(firstTab, title).first().waitFor();
    await selectIssue(firstTab, title);
    await selectIssue(secondTab, title);
    const afterReload = await readDetail(base, id);
    assert.equal(afterReload.issue.status, "done");
    const staleRevision = afterReload.issue.revision;
    const conflictTitle = `${title} loser draft`;
    const winnerTitle = `${title} winner`;
    const loserEdit = secondTab.getByRole("form", { name: "edit issue" });
    const winnerEdit = firstTab.getByRole("form", { name: "edit issue" });
    await loserEdit.getByRole("textbox", { name: "Title" }).fill(conflictTitle);
    await winnerEdit.getByRole("textbox", { name: "Title" }).fill(winnerTitle);
    await firstTab.getByRole("button", { name: /Save \(rev/ }).click();
    await firstDetail.getByText(winnerTitle).waitFor();
    await secondDetail.getByText(winnerTitle).waitFor();
    const beforeLoser = await readDetail(base, id);
    assert.equal(beforeLoser.issue.title, winnerTitle);
    assert.equal(beforeLoser.issue.revision, staleRevision + 1);
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
    await rowFor(firstTab, "CLI saved").first().waitFor();
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
    await selectIssue(firstTab, "CLI saved");
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
    await selectIssue(firstTab, winnerTitle);
    const restartEdit = firstTab.getByRole("form", { name: "edit issue" });
    await restartEdit.getByLabel("Title", { exact: true }).fill("My local title");
    await firstTab.getByRole("textbox", { name: "Comment", exact: true }).fill("My local comment");
    const droppedRevision = savedBeforeRestart.issue.revision;
    await restart();
    assert.deepEqual(await readDetail(base, id), savedBeforeRestart);
    await firstTab
      .getByRole("alert")
      .filter({ hasText: /live|connect/i })
      .waitFor();
    const changed = await fetch(`${base}/api/issues/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseRevision: droppedRevision, title: "Saved after restart" }),
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
    assert.equal(parseEditSent(String(rejected.request().postData())), droppedRevision);
    await firstTab.getByText("Someone else saved first").waitFor();

    assert.deepEqual(pageErrors, []);
    await cleanup();
  } catch (error: unknown) {
    await cleanup();
    throw error;
  }
}

await main();
