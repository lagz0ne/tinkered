import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright";

type OwnedServer = { readonly child: ChildProcess; readonly ended: Promise<unknown> };

const APP = process.cwd();
const A = "Ada";
const LIN = "Lin";
const SAM = "Sam";
const PROOF = "T05 browser proof";

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

async function waitOk(base: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15000;
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  for (;;) {
    if (child.exitCode !== null) throw new Error(stderr || "server exited early");
    try {
      if ((await fetch(`${base}/api/issues`)).ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("server start timed out");
    await nextTurn();
  }
}

async function startServer(port: number, db: string): Promise<OwnedServer> {
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/server/main.ts"], {
    cwd: APP,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DATA_PATH: db },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.resume();
  const ended = new Promise<unknown>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  await waitOk(`http://127.0.0.1:${port}`, child);
  return { child, ended };
}

async function stopServer(server: OwnedServer): Promise<void> {
  server.child.kill("SIGTERM");
  const outcome = (await bounded(server.ended, "server stop timed out")) as {
    code: number | null;
  };
  assert.equal(outcome.code, 0);
}

async function saveJson(
  base: string,
  path: string,
  body: unknown,
  method = "POST",
): Promise<{ readonly status: number; readonly body: unknown }> {
  const options: RequestInit =
    method === "GET"
      ? {}
      : {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        };
  const res = await fetch(`${base}${path}`, options);
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

function readId(body: unknown): string {
  assert.ok(typeof body === "object" && body !== null && "id" in body);
  const id = (body as { id: unknown }).id;
  assert.equal(typeof id, "string");
  return id as string;
}

function readRevision(body: unknown): number {
  assert.ok(typeof body === "object" && body !== null && "revision" in body);
  const revision = (body as { revision: unknown }).revision;
  assert.equal(typeof revision, "number");
  return revision as number;
}

async function openIssue(page: Page, title: string): Promise<void> {
  await page
    .getByRole("button", { name: new RegExp(title) })
    .first()
    .click();
  await page.getByRole("heading", { name: title }).waitFor();
}

async function failProof(browser: Browser, servers: OwnedServer[], error: unknown): Promise<never> {
  await browser.close();
  for (const server of servers) {
    if (server.child.exitCode === null) {
      server.child.kill("SIGTERM");
      await bounded(server.ended, "cleanup timed out").catch(() => server.child.kill("SIGKILL"));
    }
  }
  throw error;
}

async function main(): Promise<void> {
  const { dir, db } = tempData();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const servers: OwnedServer[] = [];
  const browser = await chromium.launch();
  const pageErrors: string[] = [];
  try {
    servers.push(await startServer(port, db));
    const first = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const second = await browser.newPage({ viewport: { width: 390, height: 844 } });
    first.on("pageerror", (error) => pageErrors.push(String(error)));
    second.on("pageerror", (error) => pageErrors.push(String(error)));
    await first.goto(base);
    await second.goto(base);
    await first.getByRole("heading", { name: "Issues" }).waitFor();
    await second.getByRole("heading", { name: "Issues" }).waitFor();

    const title = `${PROOF} ${Date.now()}`;
    await first.getByLabel("Title").fill(title);
    await first.getByLabel("Description").fill("saved once, seen twice");
    await first.getByRole("button", { name: "Create issue" }).click();
    await first.getByText(title).waitFor();
    await second.getByText(title).waitFor();

    await openIssue(first, title);
    const edit = first.getByRole("form", { name: "edit issue" });
    await edit.getByLabel("Status").selectOption("in_progress");
    await edit.getByLabel("Assignee").selectOption(A);
    await first.getByRole("button", { name: /Save \(rev/ }).click();
    await first
      .getByRole("region", { name: "issue detail" })
      .getByText("In progress · Ada")
      .waitFor();
    await second.getByText("In progress").first().waitFor();

    await openIssue(second, title);
    await second.getByRole("textbox", { name: "Comment" }).fill("seen across tabs");
    await second.getByRole("button", { name: "Add comment" }).click();
    await second
      .getByRole("region", { name: "issue detail" })
      .getByText("seen across tabs")
      .waitFor();
    await first
      .getByRole("region", { name: "issue detail" })
      .getByText("seen across tabs")
      .waitFor();

    await first.getByRole("textbox", { name: "Comment" }).fill("draft stays local");
    const secondEdit = second.getByRole("form", { name: "edit issue" });
    await secondEdit.getByLabel("Status").selectOption("done");
    await second.getByRole("button", { name: /Save \(rev/ }).click();
    await second.getByRole("region", { name: "issue detail" }).getByText("Done · Ada").waitFor();
    assert.equal(
      await first.getByRole("textbox", { name: "Comment" }).inputValue(),
      "draft stays local",
    );

    const targets = await first
      .locator("button,input,select,textarea")
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    assert.ok(targets.length > 0);
    assert.ok(targets.every((height) => height >= 44));
    assert.equal(
      await first.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );

    const detail = await (await fetch(`${base}/api/issues`)).json();
    const id = readId(
      (detail as unknown[]).find((row) => (row as { title: string }).title === title),
    );
    const conflictTitle = `${title} loser draft`;
    const secondDetail = second.getByRole("region", { name: "issue detail" });
    await secondDetail.getByText("Done · Ada").waitFor();
    const firstDetail = first.getByRole("region", { name: "issue detail" });
    await firstDetail.getByText("Done · Ada").waitFor();
    const loserEdit = second.getByRole("form", { name: "edit issue" });
    await loserEdit.getByRole("textbox", { name: "Title" }).fill(conflictTitle);
    await edit.getByRole("textbox", { name: "Title" }).fill(`${title} winner`);
    await first.getByRole("button", { name: /Save \(rev/ }).click();
    await firstDetail.getByText(`${title} winner`).waitFor();
    await secondDetail.getByText(`${title} winner`).waitFor();
    const beforeLoser = await (await fetch(`${base}/api/issues/${id}`)).json();
    await second.getByRole("button", { name: /Save \(rev/ }).click();
    await second.getByText("Someone else saved first").waitFor();
    assert.equal(
      await loserEdit.getByRole("textbox", { name: "Title" }).inputValue(),
      conflictTitle,
    );
    assert.deepEqual(await (await fetch(`${base}/api/issues/${id}`)).json(), beforeLoser);
    await second.getByRole("button", { name: "Reload their change" }).click();
    await secondDetail.getByText(`${title} winner`).waitFor();
    assert.equal(
      await loserEdit.getByRole("textbox", { name: "Title" }).inputValue(),
      `${title} winner`,
    );

    const cliSaved = await saveJson(base, "/api/issues", {
      title: "CLI saved",
      description: "via tools",
    });
    assert.equal(cliSaved.status, 201);
    const cliId = readId(cliSaved.body);
    await first.getByText("CLI saved").waitFor();
    const cliRevision = readRevision(cliSaved.body);
    const cliEdited = await saveJson(
      base,
      `/api/issues/${cliId}`,
      { baseRevision: cliRevision, status: "done", assignee: SAM },
      "PATCH",
    );
    assert.equal(cliEdited.status, 200);
    const cliCommented = await saveJson(base, `/api/issues/${cliId}/comments`, {
      author: LIN,
      text: "Shipped",
    });
    assert.equal(cliCommented.status, 201);
    await first.getByText("Shipped").first().waitFor();

    await first.reload();
    await first.getByRole("heading", { name: "Issues" }).waitFor();
    await first.getByText(`${title} winner`).waitFor();

    const savedBeforeRestart = await (await fetch(`${base}/api/issues/${id}`)).json();
    await stopServer(servers.pop() as OwnedServer);
    servers.push(await startServer(port, db));
    await first.goto(base);
    await first.getByRole("heading", { name: "Issues" }).waitFor();
    await first.getByText(`${title} winner`).waitFor();
    assert.deepEqual(await (await fetch(`${base}/api/issues/${id}`)).json(), savedBeforeRestart);

    await openIssue(first, `${title} winner`);
    const restartEdit = first.getByRole("form", { name: "edit issue" });
    await restartEdit.getByLabel("Title", { exact: true }).fill("My local title");
    await first.getByRole("textbox", { name: "Comment", exact: true }).fill("My local comment");
    const savedRevision = readRevision((savedBeforeRestart as { issue: unknown }).issue);
    await stopServer(servers.pop() as OwnedServer);
    servers.push(await startServer(port, db));
    await first
      .getByRole("alert")
      .filter({ hasText: /live|connect/i })
      .waitFor();
    const afterRestart = await saveJson(
      base,
      `/api/issues/${id}`,
      { baseRevision: savedRevision, title: "Saved after restart" },
      "PATCH",
    );
    assert.equal(afterRestart.status, 200);
    const reconnect = first.getByRole("button", { name: /^Reconnect$/i });
    if ((await reconnect.count()) > 0) await reconnect.click();
    await first
      .getByRole("heading", { name: "Saved after restart", exact: true })
      .waitFor({ timeout: 8000 });
    assert.equal(
      await restartEdit.getByLabel("Title", { exact: true }).inputValue(),
      "My local title",
    );
    assert.equal(
      await first.getByRole("textbox", { name: "Comment", exact: true }).inputValue(),
      "My local comment",
    );
    const rejected = await saveJson(
      base,
      `/api/issues/${id}`,
      { baseRevision: savedRevision, title: "Late write" },
      "PATCH",
    );
    assert.equal(rejected.status, 409);

    assert.deepEqual(pageErrors, []);
    await first.close();
    await second.close();
    await browser.close();
    for (const server of servers.splice(0)) await stopServer(server);
    removeTemp(dir);
  } catch (error: unknown) {
    removeTemp(dir);
    await failProof(browser, servers, error);
  }
}

await main();
