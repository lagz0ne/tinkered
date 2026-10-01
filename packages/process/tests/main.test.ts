import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { expect, inject, test } from "vite-plus/test";

declare module "vite-plus/test" {
  /** Vitest uses this open registry for context supplied by its runner. */
  interface ProvidedContext {
    activeMutant: string | undefined;
  }
}

type ChildResult = { code: number | null; signal: string | null; stdout: string; stderr: string };

const fixture = fileURLToPath(new URL("./fixtures/main.ts", import.meta.url));

function readPipe(stream: Readable) {
  const chunks: string[] = [];
  stream.setEncoding("utf8").on("data", (text: string) => chunks.push(text));
  return (): string => chunks.join("");
}

/** Child Node processes read the active fault from their environment, outside Vitest's worker. */
function childEnv(env: Record<string, string>) {
  return {
    ...process.env,
    ...env,
    __STRYKER_ACTIVE_MUTANT__:
      process.env.STRYKER_MUTATOR_WORKER === undefined ? undefined : inject("activeMutant"),
  };
}

function child(args: string[], env: Record<string, string> = {}) {
  const processChild = spawn(process.execPath, ["--experimental-strip-types", fixture, ...args], {
    env: childEnv(env),
    timeout: 2_000,
    killSignal: "SIGKILL",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const out = readPipe(processChild.stdout);
  const err = readPipe(processChild.stderr);
  const done = new Promise<ChildResult>((resolve, reject) => {
    processChild.once("error", reject);
    processChild.once("close", (code, signal) =>
      resolve({ code, signal, stdout: out(), stderr: err() }),
    );
  });
  return { process: processChild, out, done };
}

test("main lets each full 1 MiB pipe write finish before the app exits", async () => {
  const result = await child(["output"]).done;
  expect(result).toEqual({
    code: 7,
    signal: null,
    stdout: "o".repeat(1_048_576),
    stderr: "e".repeat(1_048_576),
  });
});

test("main reads real args and env and removes both stop listeners after return", async () => {
  expect(await child(["facts", "a", "--listeners"], { TK_PROBE: "yes" }).done).toEqual({
    code: 0,
    signal: null,
    stdout: "a+--listeners yes\nlisteners 0 0\n",
    stderr: "",
  });
});

test("main accepts explicit args instead of host argv", async () => {
  expect(await child(["--explicit"], { TK_PROBE: "yes" }).done).toEqual({
    code: 0,
    signal: null,
    stdout: "given yes\n",
    stderr: "",
  });
});

test("main returns 2 for an unknown route and writes usage to stderr", async () => {
  expect(await child(["unknown"]).done).toEqual({
    code: 2,
    signal: null,
    stdout: "",
    stderr: "usage: fixture <command>\n  facts\n  hang\n  output\n  serve\n",
  });
});

test("a real command SIGINT exits 130", async () => {
  const running = child(["hang"]);
  try {
    await expect.poll(running.out).toBe("ready\n");
    running.process.kill("SIGINT");
    expect(await running.done).toEqual({ code: 130, signal: null, stdout: "ready\n", stderr: "" });
  } finally {
    running.process.kill("SIGKILL");
    await running.done;
  }
});

test("stdin EOF stops a service and waits for cleanup", async () => {
  const running = child(["serve"]);
  try {
    await expect.poll(running.out).toBe("ready\n");
    running.process.stdin.end();
    expect(await running.done).toEqual({
      code: 0,
      signal: null,
      stdout: "ready\nclosing 1 1\nclosed\n",
      stderr: "",
    });
  } finally {
    running.process.kill("SIGKILL");
    await running.done;
  }
});

test.each(["SIGINT", "SIGTERM"] as const)(
  "a service %s removes both listeners and closes gracefully",
  async (signal) => {
    const running = child(["serve"]);
    try {
      await expect.poll(running.out).toBe("ready\n");
      running.process.kill(signal);
      expect(await running.done).toEqual({
        code: 0,
        signal: null,
        stdout: "ready\nclosing 0 0\nclosed\n",
        stderr: "",
      });
    } finally {
      running.process.kill("SIGKILL");
      await running.done;
    }
  },
);

test("a second OS signal terminates stalled service cleanup normally", async () => {
  const running = child(["serve", "stalled"]);
  try {
    await expect.poll(running.out).toBe("ready\n");
    running.process.kill("SIGINT");
    await expect.poll(running.out).toBe("ready\nclosing 0 0\n");
    running.process.kill("SIGTERM");
    expect(await running.done).toEqual({
      code: null,
      signal: "SIGTERM",
      stdout: "ready\nclosing 0 0\n",
      stderr: "",
    });
  } finally {
    running.process.kill("SIGKILL");
    await running.done;
  }
});
