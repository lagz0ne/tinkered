import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { expect, test } from "vite-plus/test";
import {
  createScope,
  isError as isCoreError,
  makeTestClock,
  operation,
  resource,
  type Observe,
  type Scope,
} from "@tinker/core";
import { cli, command, type Cli } from "../src/index.ts";

/** Parse argv[0] into a number; a throw becomes the op's parse failure (exit 2). */
function parseCount(raw: unknown): number {
  if (typeof raw !== "string") throw new Error("bad count");
  const count = Number(raw);
  if (Number.isNaN(count)) throw new Error("bad count");
  return count;
}

const double = operation({
  label: "double",
  input: parseCount,
  run: (_deps, ctx) => ctx.input * 2,
});

const ping = operation({ label: "ping", run: () => "pong" });

const silent = operation({ label: "silent", run: () => undefined });

const broken = operation({
  label: "broken",
  run: () => {
    throw new Error("boom");
  },
});

type Opened = { readonly scope: Scope.Handle; readonly run: Cli.Run };

/** Install the wiring on a scope and resolve its run: the root's hand, in hand. */
async function openScope(
  wiring: Cli.Wiring,
  options?: Omit<Scope.Options, "extensions" | "tags">,
): Promise<Opened> {
  const ext = cli(wiring);
  const scope = createScope({ ...options, extensions: [ext] });
  await scope.ready;
  return { scope, run: scope.resolve(ext) };
}

/** Run one argv through the extension and close the root, like today’s `run`. */
async function answer(
  wiring: Cli.Wiring,
  argv: readonly string[],
  extra?: { readonly io?: Cli.Io; readonly options?: Omit<Scope.Options, "extensions" | "tags"> },
): Promise<Cli.Result> {
  const { scope, run } = await openScope(wiring, extra?.options);
  const result = await run(argv, extra?.io);
  await scope.close({ graceful: true });
  return result;
}

test("help loads nothing and lists the bound names with exit 0", async () => {
  let loads = 0;
  const result = await answer(
    {
      name: "app",
      version: "1.2.3",
      commands: [
        command(
          "double",
          () => {
            loads += 1;
            return double;
          },
          { input: (argv) => argv[0] },
        ),
        command("ping", () => {
          loads += 1;
          return ping;
        }),
      ],
    },
    ["help"],
  );
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("app 1.2.3\n  double\n  ping\n");
  expect(result.stderr).toBe("");
  expect(loads).toBe(0);
});

test("help lists a row description beside the name", async () => {
  const result = await answer(
    {
      name: "app",
      version: "1.2.3",
      commands: [
        command("dbl", () => double, {
          input: (argv) => argv[0],
          description: "double a number",
        }),
        command("ping", () => ping),
      ],
    },
    ["help"],
  );
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("app 1.2.3\n  dbl  double a number\n  ping\n");
});

test("commands take nested lists and false, read flat in order", async () => {
  const flags = { extra: false };
  const result = await answer(
    {
      name: "app",
      version: "1.2.3",
      commands: [
        command("ping", () => ping),
        [null, [command("dbl", () => double, { input: (argv) => argv[0] })]],
        flags.extra && command("never", () => ping),
      ],
    },
    ["help"],
  );
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("app 1.2.3\n  dbl\n  ping\n");
});

test("a missing command prints usage with exit 2", async () => {
  const result = await answer(
    { name: "app", version: "1.2.3", commands: [command("ping", () => ping)] },
    [],
  );
  expect(result.code).toBe(2);
  expect(result.stdout).toBe("app 1.2.3\n  ping\n");
});

test("an unknown command prints usage to stderr with exit 2 and loads nothing", async () => {
  let loads = 0;
  const result = await answer(
    {
      name: "app",
      version: "1.2.3",
      commands: [
        command("ping", () => {
          loads += 1;
          return ping;
        }),
      ],
    },
    ["nope"],
  );
  expect(result.code).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("app 1.2.3\n  ping\n");
  expect(loads).toBe(0);
});

test("the selected command loads once and answers through the default JSON respond", async () => {
  let loads = 0;
  const result = await answer(
    {
      name: "app",
      version: "1.0.0",
      commands: [
        command(
          "double",
          () => {
            loads += 1;
            return double;
          },
          { input: (argv) => argv[0] },
        ),
        command("ping", () => {
          loads += 1;
          return ping;
        }),
      ],
    },
    ["double", "21"],
  );
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("42\n");
  expect(loads).toBe(1);
});

test("the selected loader runs once across two runs on one scope", async () => {
  let loads = 0;
  const { scope, run } = await openScope({
    name: "app",
    version: "1.0.0",
    commands: [
      command(
        "double",
        () => {
          loads += 1;
          return double;
        },
        { input: (argv) => argv[0] },
      ),
    ],
  });
  const first = await run(["double", "21"]);
  const second = await run(["double", "21"]);
  await scope.close({ graceful: true });
  expect(first.stdout).toBe("42\n");
  expect(second.stdout).toBe("42\n");
  expect(loads).toBe(1);
});

test("an eager handle runs without a loader", async () => {
  const result = await answer(
    { name: "app", version: "1.0.0", commands: [command("ping", ping)] },
    ["ping"],
  );
  expect(result.code).toBe(0);
  expect(result.stdout).toBe('"pong"\n');
});

test("an async loader resolves before the command runs", async () => {
  const result = await answer(
    { name: "app", version: "1.0.0", commands: [command("ping", () => Promise.resolve(ping))] },
    ["ping"],
  );
  expect(result.code).toBe(0);
  expect(result.stdout).toBe('"pong"\n');
});

test("an op parse failure prints usage to stderr with exit 2", async () => {
  const result = await answer(
    {
      name: "app",
      version: "1.0.0",
      commands: [command("double", () => double, { input: (argv) => argv[0] })],
    },
    ["double", "abc"],
  );
  expect(result.code).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("app 1.0.0\n  double\n");
});

test("a throwing op prints to stderr with exit 1", async () => {
  const result = await answer(
    { name: "app", version: "1.0.0", commands: [command("broken", () => broken)] },
    ["broken"],
  );
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("boom");
});

test("a void op prints nothing on success", async () => {
  const result = await answer(
    { name: "app", version: "1.0.0", commands: [command("silent", () => silent)] },
    ["silent"],
  );
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
});

test("respond overrides the default output", async () => {
  const result = await answer(
    {
      name: "app",
      version: "1.0.0",
      commands: [
        command("double", () => double, { input: (argv) => argv[0], respond: (n) => `n=${n}\n` }),
      ],
    },
    ["double", "21"],
  );
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("n=42\n");
});

test("an entry command receives argv only", async () => {
  let seen: readonly string[] | undefined;
  const result = await answer(
    {
      name: "app",
      version: "1.0.0",
      commands: [
        command.entry("serve", (argv) => {
          seen = argv;
        }),
      ],
    },
    ["serve", "--port", "8080"],
  );
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(seen).toEqual(["--port", "8080"]);
});

test("a throwing entry command exits 1", async () => {
  const result = await answer(
    {
      name: "app",
      version: "1.0.0",
      commands: [
        command.entry("serve", () => {
          throw new Error("no port");
        }),
      ],
    },
    ["serve"],
  );
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("no port");
});

test("the command span parents the op span with one cli command log line", async () => {
  const logs: Observe.Log[] = [];
  const clock = makeTestClock({ now: 1000 });
  const ioChunks: string[] = [];
  const result = await answer(
    {
      name: "app",
      version: "1.0.0",
      commands: [command("double", () => double, { input: (argv) => argv[0] })],
    },
    ["double", "21"],
    {
      options: { clock, observe: { history: 20, log: (entry) => logs.push(entry) } },
      io: {
        stdout: (s) => ioChunks.push(s),
        stderr: () => undefined,
      },
    },
  );
  expect(result.code).toBe(0);
  expect(ioChunks.join("")).toBe("42\n");
  expect(logs.length).toBe(1);
  const line = logs[0];
  expect(line.message).toBe("cli command");
  expect(line.attributes.command).toBe("double");
  expect(line.attributes.code).toBe(0);
  expect(line.attributes.ms).toBe(0);
  const head = line.span;
  expect(head?.name).toBe("app double");
  expect(head?.attributes.command).toBe("double");
  expect(head?.attributes.args).toEqual(["21"]);
});

test("a session-target resource defer sees success on exit 0 and failed on exit 1", async () => {
  const ends: string[] = [];
  const guarded = resource({
    label: "guarded",
    target: "session",
    factory: (_deps, ctx) => {
      ctx.defer((end) => {
        ends.push(end.status);
      });
      return "open";
    },
  });
  const use = operation({
    label: "use",
    depends: { guarded },
    run: ({ guarded }) => guarded,
  });
  const fail = operation({
    label: "fail",
    depends: { guarded },
    run: ({ guarded }) => {
      if (guarded !== "open") throw new Error("unreachable");
      throw new Error("bad");
    },
  });
  const wiring: Cli.Wiring = {
    name: "app",
    version: "1.0.0",
    commands: [command("use", () => use), command("fail", () => fail)],
  };
  const good = await answer(wiring, ["use"]);
  const bad = await answer(wiring, ["fail"]);
  expect(good.code).toBe(0);
  expect(bad.code).toBe(1);
  expect(ends).toEqual(["success", "failed"]);
});

test("an aborted signal exits 130 and the session-target defer sees cancelled", async () => {
  const ends: string[] = [];
  const logs: Observe.Log[] = [];
  let started = false;
  const slow = operation({
    label: "slow",
    run: (_deps, { clock, signal, defer }) => {
      started = true;
      defer((end) => {
        ends.push(end.status);
      });
      return clock.sleep(10_000, signal);
    },
  });
  const clock = makeTestClock({ now: 0 });
  const ac = new AbortController();
  const { scope, run } = await openScope(
    { name: "app", version: "1.0.0", commands: [command("slow", () => slow)] },
    { clock, observe: { history: 20, log: (entry) => logs.push(entry) } },
  );
  const pending = run(["slow"], {
    stdout: () => undefined,
    stderr: () => undefined,
    signal: ac.signal,
  });
  while (!started) await Promise.resolve();
  ac.abort();
  const result = await pending;
  await scope.close({ graceful: true });
  expect(result.code).toBe(130);
  expect(logs.some((line) => line.message === "cli command" && line.attributes.code === 130)).toBe(
    true,
  );
  expect(ends).toEqual(["cancelled"]);
});

test("io writers see the same streams the result collects", async () => {
  const seenOut: string[] = [];
  const seenErr: string[] = [];
  const result = await answer(
    { name: "app", version: "1.0.0", commands: [command("broken", () => broken)] },
    ["broken"],
    { io: { stdout: (s) => seenOut.push(s), stderr: (s) => seenErr.push(s) } },
  );
  expect(result.code).toBe(1);
  expect(seenErr.join("")).toBe(result.stderr);
  expect(seenOut.join("")).toBe(result.stdout);
});

test("resolving run before ready fails with NotResolved", async () => {
  const ext = cli({ name: "app", version: "1.0.0", commands: [command("ping", ping)] });
  const scope = createScope({ extensions: [ext] });
  try {
    scope.resolve(ext);
    expect.unreachable();
  } catch (error: unknown) {
    if (!isCoreError(error, "NotResolved")) throw error;
    expect(error.payload.label).toBe("cli");
  }
  await scope.close({ graceful: true });
});

/** The repo root: the nearest ancestor holding `pnpm-workspace.yaml`. Stryker copies this file
 * into a sandbox two levels deeper, so a fixed `../../..` would miss the examples there. */
function workspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) dir = dirname(dir);
  return dir;
}

test("the process smoke test: node runs the example and help exits 0 with usage", async () => {
  const child = await new Promise<{ code: number; out: string; err: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      ["--experimental-strip-types", "cli/main.ts", "help"],
      { cwd: join(workspaceRoot(), "examples") },
      (error, stdout, stderr) => {
        if (error && error.code === undefined) reject(error);
        else
          resolve({
            code: typeof error?.code === "number" ? error.code : 0,
            out: String(stdout),
            err: String(stderr),
          });
      },
    );
  });
  expect(child.err).toBe("");
  expect(child.code).toBe(0);
  expect(child.out).toBe("tinker 0.0.0\n  greet\n  ping\n");
});
