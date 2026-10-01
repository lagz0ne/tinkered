import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, onTestFinished, test } from "vite-plus/test";
import { build } from "vite-plus";
import { childEnv } from "./child-env.ts";
import { createScope, operation } from "@tinker/core";
import { backend, HttpRequest, HttpResponse, isError as isHttpError, send } from "@tinker/http";
import { api, runServer } from "../src/index.ts";

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = join(APP, "scratch");
mkdirSync(scratch, { recursive: true });
const bundle = mkdtempSync(join(scratch, "tracker-entry-"));

beforeAll(async () => {
  await build({
    root: APP,
    logLevel: "silent",
    build: { ssr: "src/server/main.ts", outDir: bundle },
  });
});
afterAll(() => rmSync(bundle, { recursive: true, force: true }));

/** Settings fail before any database work. Read the boot outcome, then wait
 * for child cleanup before removing its temporary directory. */
async function readBootResult(settings: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "issues-port-"));
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    NATS_URL: undefined,
    DATA_PATH: join(dir, "db"),
    ...settings,
  };
  const stop = new AbortController();
  const done = runServer(env, stop.signal);
  onTestFinished(async () => {
    stop.abort();
    await done;
    rmSync(dir, { recursive: true, force: true });
  });
  expect(await done).toBe(1);
  const child = spawn(process.execPath, [join(bundle, "main.js")], {
    cwd: APP,
    env: childEnv(env),
    stdio: ["ignore", "pipe", "ignore"],
  });
  const exited = once(child, "exit");
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const result: Record<string, unknown> = JSON.parse(line);
      if (result.message === "boot failed" || result.message === "listening") return result;
    }
    return {};
  } finally {
    child.kill();
    await exited;
  }
}

test("a PORT that is not a port number fails the boot naming PORT", async () => {
  const first = await readBootResult({ PORT: "abc" });
  expect(first.message).toBe("boot failed");
  expect(first.kind).toBe("BadListenSettings");
  expect(first.payload).toEqual({ keys: ["PORT"] });
  expect(first.extension).toBe("issues.root");
});

test("a PORT with trailing junk or out of range fails the boot too", async () => {
  expect((await readBootResult({ PORT: "80x" })).payload).toEqual({ keys: ["PORT"] });
  expect((await readBootResult({ PORT: "70000" })).payload).toEqual({ keys: ["PORT"] });
});

test.each([undefined, ""])("API and CLI name a missing or empty DATA_PATH: %j", async (value) => {
  const result = await readBootResult({ PORT: "4311", DATA_PATH: value });
  expect(result.message).toBe("boot failed");
  expect(result.kind).toBe("BadDataSettings");
  expect(result.payload).toEqual({ keys: ["DATA_PATH"] });
  expect(result.extension).toBe("issues.root");
});

/** A 500 through a baseUrl-only binding still rejects: the helper folds the policy in. */
test("api.config with no accept still rejects a 500 as ResponseFailed", async () => {
  const down = backend(async (request) => HttpResponse.make(request, { status: 500, body: "x" }));
  const scope = createScope({ tags: [down, api.config({ baseUrl: "http://x" })] });
  const raw = operation({
    label: "raw",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("http://x/a") }),
  });
  try {
    await scope.run(raw);
    expect.unreachable();
  } catch (error) {
    if (!isHttpError(error, "ResponseFailed")) throw error;
    expect(error.payload.reason).toBe("StatusCode");
  }
  await scope.close();
});

/** A 409 passes the helper's default filter and stays readable. */
test("api.config with no accept still delivers a 409", async () => {
  const conflict = backend(async (request) =>
    HttpResponse.make(request, { status: 409, body: '{"id":"i1"}' }),
  );
  const scope = createScope({ tags: [conflict, api.config({ baseUrl: "http://x" })] });
  const raw = operation({
    label: "raw",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("http://x/a") }),
  });
  const res = await scope.run(raw);
  expect(res.status).toBe(409);
  expect(await res.text()).toBe('{"id":"i1"}');
  await scope.close();
});

/** An explicit accept overrides the helper's default. */
test("api.config with an explicit accept uses it instead", async () => {
  const missing = backend(async (request) =>
    HttpResponse.make(request, { status: 404, body: "nf" }),
  );
  const scope = createScope({
    tags: [missing, api.config({ baseUrl: "http://x", accept: (_status) => true })],
  });
  const raw = operation({
    label: "raw",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("http://x/a") }),
  });
  const res = await scope.run(raw);
  expect(res.status).toBe(404);
  await scope.close();
});
