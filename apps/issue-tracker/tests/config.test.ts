import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { createScope, operation } from "@tinker/core";
import { backend, HttpRequest, HttpResponse, isError as isHttpError, send } from "@tinker/http";
import { api } from "../src/index.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Migrations log queries before listener validation. Read the boot outcome,
 * then wait for child cleanup before deleting its database. */
async function readBootResult(port: string): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "issues-port-"));
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/server/main.ts"], {
    cwd: APP,
    env: { ...process.env, HOST: "127.0.0.1", PORT: port, DATA_PATH: join(dir, "db") },
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
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a PORT that is not a port number fails the boot naming PORT", async () => {
  const first = await readBootResult("abc");
  expect(first.message).toBe("boot failed");
  expect(first.kind).toBe("BadListenSettings");
  expect(first.payload).toEqual({ keys: ["PORT"] });
});

test("a PORT with trailing junk or out of range fails the boot too", async () => {
  expect((await readBootResult("80x")).payload).toEqual({ keys: ["PORT"] });
  expect((await readBootResult("70000")).payload).toEqual({ keys: ["PORT"] });
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
