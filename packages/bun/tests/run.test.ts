import type { Subprocess } from "bun";
import { afterEach, expect, test } from "vite-plus/test";

const children: Subprocess[] = [];

/** A failed test must not leave its host running: `bun test` would wait for it. */
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

/** Reads a host's stdout lines to their end. */
const rest = async (lines: ReadableStreamDefaultReader<string>) => {
  let text = "";
  for (let next = await lines.read(); !next.done; next = await lines.read()) text += next.value;
  return text;
};

/**
 * Runs a fixture host on a free port; resolves its URL from the `tinker: listening` line. `rest`
 * reads the host's stdout to its end.
 */
const host = async (fixture: string, args: string[] = []) => {
  const child = Bun.spawn(
    [process.execPath, new URL(`fixtures/${fixture}`, import.meta.url).pathname, ...args],
    {
      env: { ...process.env, PORT: "0" },
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  children.push(child);

  const lines = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let seen = "";
  for (let next = await lines.read(); !next.done; next = await lines.read()) {
    seen += next.value;
    const url = /tinker: listening on (\S+)/.exec(seen)?.[1];
    if (url) return { child, url: new URL(url), seen, rest: () => rest(lines) };
  }
  return { child, url: undefined, seen, rest: () => rest(lines) };
};

test("a stream quiet for longer than Bun's 10 s default is not reset", async () => {
  const { child, url } = await host("stream-host.ts");
  expect(url).toBeDefined();

  const text = await fetch(new URL("/api/stream", url)).then((reply) => reply.text());
  expect(text).toBe("one\ntwo\n");

  child.kill("SIGTERM");
  expect(await child.exited).toBe(143);
}, 30_000);

test("a command that exits during start exits with its code and never listens", async () => {
  const child = Bun.spawn(
    [process.execPath, new URL("fixtures/exit-host.ts", import.meta.url).pathname],
    {
      env: { ...process.env, PORT: "0" },
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  children.push(child);

  const stdout = await new Response(child.stdout).text();
  expect(await child.exited).toBe(64);
  expect(stdout).not.toContain("tinker: listening");
});

test("a command that exits during start still waits for its root to close, and never listens", async () => {
  const child = Bun.spawn(
    [process.execPath, new URL("fixtures/exit-closed-host.ts", import.meta.url).pathname],
    {
      env: { ...process.env, PORT: "0" },
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  children.push(child);

  const stdout = await new Response(child.stdout).text();
  expect(await child.exited).toBe(64);
  expect(stdout).toContain("closed\n");
  expect(stdout).not.toContain("tinker: listening");
});

test("extra paths go to the command, beside /api/* and /rpc/*", async () => {
  const { url } = await host("paths-host.ts");
  const text = (path: string) => fetch(new URL(path, url)).then((reply) => reply.text());

  expect(await text("/mcp")).toBe("cmd");
  expect(await text("/.well-known/x")).toBe("cmd");
  expect(await text("/api/x")).toBe("cmd");
  expect(await text("/rpc/x")).toBe("cmd");
  expect(await text("/a/b")).toBe("page");
});

test("with no extra paths, /mcp gets the page", async () => {
  const { url } = await host("page-host.ts");
  const text = (path: string) => fetch(new URL(path, url)).then((reply) => reply.text());

  expect(await text("/mcp")).toBe("page");
  expect(await text("/api/x")).toBe("cmd");
});

test("a hang-up (SIGHUP) closes the port and the root, then exits 129", async () => {
  const { child, url, rest } = await host("page-host.ts");
  expect(url).toBeDefined();

  child.kill("SIGHUP");

  expect(await child.exited).toBe(129);
  // Bun's own hang-up exit also reads 129; a kill by the signal sets signalCode.
  expect(child.signalCode).toBeNull();
  expect(await rest()).toContain("closed\n");
});

/** Runs the throw fixture in one mode; its exit code and its output. */
const fails = async (mode: string, signal?: NodeJS.Signals) => {
  const child = Bun.spawn(
    [process.execPath, new URL("fixtures/throw-host.ts", import.meta.url).pathname],
    { env: { ...process.env, PORT: "0", THROW: mode }, stdout: "pipe", stderr: "pipe" },
  );
  children.push(child);
  if (signal) {
    const lines = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
    await lines.read(); // "starting"
    child.kill(signal);
  }

  const [code, err] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { code, err };
};

test("a config error at start exits 78 and names its kind; a bad URL is one too", async () => {
  const config = await fails("config");

  expect(config.code).toBe(78);
  expect(config.err).toContain('tinker: MissingConfig {"key":"url"}');
  expect((await fails("url")).code).toBe(78);
});

test("any other throw at start exits 1, and a failed root exits 1", async () => {
  const plain = await fails("plain");

  expect(plain.code).toBe(1);
  expect(plain.err).toContain("broke");
  const root = await fails("root");
  expect(root.code).toBe(1);
  expect(root.err).toContain("root broke");
});

test("a missing tag or a value that failed its schema at start exits 78 too", async () => {
  expect((await fails("tag")).code).toBe(78);
  expect((await fails("invalid")).code).toBe(78);
});

test("a root that closes with a teardown error exits 1 and logs it", async () => {
  const teardown = await fails("teardown");

  expect(teardown.code).toBe(1);
  expect(teardown.err).toContain("teardown broke");
});

test("a stop during start that ends in another error keeps the stop's code and logs the error", async () => {
  const other = await fails("other", "SIGINT");

  expect(other.code).toBe(130);
  expect(other.err).toContain("other broke");
});

test("with no page: the command takes its paths, a bare path is 404, and args pass", async () => {
  const { url, seen } = await host("api-host.ts", ["--a", "b"]);
  const reply = (path: string) => fetch(new URL(path, url));

  expect(seen).toContain('args ["--a","b"]');
  expect(await (await reply("/rpc")).text()).toBe("cmd");
  expect(await (await reply("/api/x")).text()).toBe("cmd");
  expect((await reply("/api/none")).status).toBe(404);
  expect((await reply("/other")).status).toBe(404);
});

test("a stop during start exits with the stop's code, and logs no second line", async () => {
  const stopped = await fails("slow", "SIGINT");

  expect(stopped.code).toBe(130);
  expect(stopped.err).toBe("");
});

test("a stop while a start waits on a lock never listens, and exits with the stop's code", async () => {
  const child = Bun.spawn(
    [process.execPath, new URL("fixtures/held-host.ts", import.meta.url).pathname],
    { env: { ...process.env, PORT: "0" }, stdout: "pipe", stderr: "pipe" },
  );
  children.push(child);

  const lines = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  const starting = await lines.read();
  child.kill("SIGTERM");

  const [code, out, err] = await Promise.all([
    child.exited,
    rest(lines),
    new Response(child.stderr).text(),
  ]);
  expect(starting.value).toBe("starting\n");
  expect(code).toBe(143);
  expect(out).not.toContain("tinker: listening");
  expect(err).toBe("");
});
