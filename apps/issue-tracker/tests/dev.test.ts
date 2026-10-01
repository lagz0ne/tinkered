import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished, test } from "vite-plus/test";
import { runServer } from "../src/index.ts";

async function readFreePort(): Promise<number> {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  try {
    const address = listener.address();
    if (address === null || typeof address === "string") return expect.unreachable();
    return address.port;
  } finally {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
}

test("dev reload keeps saved issues, ends sync, and SIGTERM exits zero", async () => {
  const app = fileURLToPath(new URL("../", import.meta.url));
  const base = fileURLToPath(new URL("../../../scratch/", import.meta.url));
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "tracker-dev-"));
  for (const file of ["src", "drizzle", "index.html", "vite.config.ts", "package.json"]) {
    await cp(join(app, file), join(directory, file), { recursive: true });
  }
  await symlink(join(app, "node_modules"), join(directory, "node_modules"));
  const port = await readFreePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/dev.ts"], {
    cwd: directory,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: undefined,
      DATA_PATH: undefined,
      NATS_URL: undefined,
      DRAFT_HELPER: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    output += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    output += chunk;
  });
  onTestFinished(async () => {
    child.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  });
  await expect.poll(() => output.match(/"kind":"ready"/g)?.length, { timeout: 30000 }).toBe(1);
  expect(await (await fetch(url)).text()).toContain("/@vite/client");
  const missing = await fetch(`${url}/missing-page`, { headers: { accept: "text/html" } });
  expect(missing.status).toBe(404);
  expect(await missing.text()).toContain("<h1>Page not found</h1>");
  const saved = await (
    await fetch(`${url}/api/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Survives a server edit", description: "kept in PGlite" }),
    })
  ).json();
  const response = await fetch(`${url}/sync?keys=issues`);
  const reader = response.body!.getReader();
  await reader.read();
  const streamEnded = (async () => {
    while (!(await reader.read()).done) {
      /** Drain until the old root closes its sync wire. */
    }
    return true;
  })();
  const routes = join(directory, "src/server/routes.ts");
  const source = await readFile(routes, "utf8");
  await writeFile(
    routes,
    source.replace('route.get("/api/issues", readIssues)', 'route.get("/api/edited", readIssues)'),
  );
  await expect.poll(() => output.match(/"kind":"ready"/g)?.length, { timeout: 30000 }).toBe(2);
  expect(await streamEnded).toBe(true);
  expect(await (await fetch(`${url}/api/edited`)).json()).toEqual([saved]);
  const component = join(directory, "src/client/App.tsx");
  const before = await readFile(component, "utf8");
  await writeFile(component, before.replace("<h1>Issues</h1>", "<h1>Saved page edit</h1>"));
  await expect.poll(() => output.match(/"kind":"ready"/g)?.length, { timeout: 30000 }).toBe(3);
  expect(await (await fetch(url)).text()).toContain("<h1>Saved page edit</h1>");
  expect(await (await fetch(`${url}/api/edited`)).json()).toEqual([saved]);
  child.kill("SIGTERM");
  expect(await exited).toEqual([0, null]);
  await expect(fetch(url)).rejects.toThrow();
}, 90000);

test.each(["HOST", "PORT", "DATA_PATH", "NATS_URL"])("prod refuses a missing %s", async (key) => {
  const directory = await mkdtemp(join(tmpdir(), "tracker-prod-"));
  const stop = new AbortController();
  const env: NodeJS.ProcessEnv = {
    HOST: "127.0.0.1",
    PORT: String(await readFreePort()),
    DATA_PATH: join(directory, "db"),
    NATS_URL: "nats://127.0.0.1:4222",
  };
  delete env[key];
  let code: number | undefined;
  const done = runServer(env, stop.signal).then((value) => {
    code = value;
  });
  onTestFinished(async () => {
    stop.abort();
    await done;
    await rm(directory, { recursive: true, force: true });
  });
  await expect.poll(() => code, { timeout: 10000 }).toBe(1);
});
