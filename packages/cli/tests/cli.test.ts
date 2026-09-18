import { execFile } from "node:child_process";
import { expect, test } from "vite-plus/test";
import { makeTestClock, operation, resource, type Observe, type Scope } from "@tinker/core";
import { command, run } from "../src/index.ts";

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

test("help loads nothing and lists the bound names with exit 0", async () => {
  let loads = 0;
  const table = [
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
  ];
  const result = await run({
    name: "app",
    version: "1.2.3",
    scope: { tags: table },
    argv: ["help"],
  });
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("app 1.2.3\n  double\n  ping\n");
  expect(result.stderr).toBe("");
  expect(loads).toBe(0);
});

test("a missing command prints usage with exit 2", async () => {
  const result = await run({
    name: "app",
    version: "1.2.3",
    scope: { tags: [command("ping", () => ping)] },
    argv: [],
  });
  expect(result.code).toBe(2);
  expect(result.stdout).toBe("app 1.2.3\n  ping\n");
});

test("an unknown command prints usage to stderr with exit 2 and loads nothing", async () => {
  let loads = 0;
  const result = await run({
    name: "app",
    version: "1.2.3",
    scope: {
      tags: [
        command("ping", () => {
          loads += 1;
          return ping;
        }),
      ],
    },
    argv: ["nope"],
  });
  expect(result.code).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("app 1.2.3\n  ping\n");
  expect(loads).toBe(0);
});

test("the selected command loads once and answers through the default JSON respond", async () => {
  let loads = 0;
  const result = await run({
    name: "app",
    version: "1.0.0",
    scope: {
      tags: [
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
    argv: ["double", "21"],
  });
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("42\n");
  expect(loads).toBe(1);
});

test("an async loader resolves before the command runs", async () => {
  const result = await run({
    name: "app",
    version: "1.0.0",
    scope: { tags: [command("ping", () => Promise.resolve(ping))] },
    argv: ["ping"],
  });
  expect(result.code).toBe(0);
  expect(result.stdout).toBe('"pong"\n');
});

test("an op parse failure prints usage to stderr with exit 2", async () => {
  const result = await run({
    name: "app",
    version: "1.0.0",
    scope: {
      tags: [command("double", () => double, { input: (argv) => argv[0] })],
    },
    argv: ["double", "abc"],
  });
  expect(result.code).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("app 1.0.0\n  double\n");
});

test("a throwing op prints to stderr with exit 1", async () => {
  const result = await run({
    name: "app",
    version: "1.0.0",
    scope: { tags: [command("broken", () => broken)] },
    argv: ["broken"],
  });
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("boom");
});

test("a void op prints nothing on success", async () => {
  const result = await run({
    name: "app",
    version: "1.0.0",
    scope: { tags: [command("silent", () => silent)] },
    argv: ["silent"],
  });
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
});

test("respond overrides the default output", async () => {
  const result = await run({
    name: "app",
    version: "1.0.0",
    scope: {
      tags: [
        command("double", () => double, { input: (argv) => argv[0], respond: (n) => `n=${n}\n` }),
      ],
    },
    argv: ["double", "21"],
  });
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("n=42\n");
});

test("an entry command receives the scope and resolves a preset resource", async () => {
  const db = resource({ label: "db", factory: () => "real" });
  let seen: unknown;
  const result = await run({
    name: "app",
    version: "1.0.0",
    scope: {
      tags: [
        command.entry("serve", () => (scope: Scope.Handle) => {
          seen = scope.resolve(db);
        }),
      ],
    },
    argv: ["serve", "--port", "8080"],
  });
  expect(result.code).toBe(0);
  expect(seen).toBe("real");
});

test("a throwing entry command exits 1", async () => {
  const result = await run({
    name: "app",
    version: "1.0.0",
    scope: {
      tags: [
        command.entry("serve", () => () => {
          throw new Error("no port");
        }),
      ],
    },
    argv: ["serve"],
  });
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("no port");
});

test("the command span parents the op span with one cli command log line", async () => {
  const logs: Observe.Log[] = [];
  const clock = makeTestClock({ now: 1000 });
  const ioChunks: string[] = [];
  const result = await run({
    name: "app",
    version: "1.0.0",
    scope: {
      tags: [command("double", () => double, { input: (argv) => argv[0] })],
      clock,
      observe: { history: 20, log: (entry) => logs.push(entry) },
    },
    io: {
      stdout: (s) => ioChunks.push(s),
      stderr: () => undefined,
    },
    argv: ["double", "21"],
  });
  expect(result.code).toBe(0);
  expect(ioChunks.join("")).toBe("42\n");
  expect(logs.length).toBe(1);
  const line = logs[0];
  expect(line.message).toBe("cli command");
  expect(line.attributes.command).toBe("double");
  expect(line.attributes.code).toBe(0);
  expect(typeof line.attributes.ms).toBe("number");
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
  const good = await run({
    name: "app",
    version: "1.0.0",
    scope: { tags: [command("use", () => use), command("fail", () => fail)] },
    argv: ["use"],
  });
  const bad = await run({
    name: "app",
    version: "1.0.0",
    scope: { tags: [command("use", () => use), command("fail", () => fail)] },
    argv: ["fail"],
  });
  expect(good.code).toBe(0);
  expect(bad.code).toBe(1);
  expect(ends).toEqual(["success", "failed"]);
});

test("an aborted signal exits 130 and the session-target defer sees cancelled", async () => {
  const ends: string[] = [];
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
  const pending = run({
    name: "app",
    version: "1.0.0",
    scope: { tags: [command("slow", () => slow)], clock },
    io: { stdout: () => undefined, stderr: () => undefined, signal: ac.signal },
    argv: ["slow"],
  });
  while (!started) await Promise.resolve();
  ac.abort();
  const result = await pending;
  expect(result.code).toBe(130);
  expect(ends).toEqual(["cancelled"]);
});

test("a command bound to a resource runs its operation and builds once", async () => {
  let builds = 0;
  const migrate = resource({
    label: "app.migrate",
    factory: () => {
      builds += 1;
      return double;
    },
  });
  const table = [command("double", migrate, { input: (argv) => argv[0] })];
  const first = await run({
    name: "app",
    version: "1.0.0",
    scope: { tags: table },
    argv: ["double", "21"],
  });
  expect(first.code).toBe(0);
  expect(first.stdout).toBe("42\n");
  expect(builds).toBe(1);
});

test("a resource-bound command opens a resource span beside the command span", async () => {
  const seen: string[] = [];
  const migrate = resource({ label: "app.migrate", factory: () => double });
  const result = await run({
    name: "app",
    version: "1.0.0",
    scope: {
      tags: [command("double", migrate, { input: (argv) => argv[0] })],
      observe: {
        history: 20,
        export: (span) => {
          seen.push(`${span.kind}:${span.name}`);
        },
      },
    },
    argv: ["double", "21"],
  });
  expect(result.code).toBe(0);
  expect(seen).toContain("resource:app.migrate");
  expect(seen).toContain("operation:app double");
});

test("help and an unknown command build no resource-bound module", async () => {
  let builds = 0;
  const migrate = resource({
    label: "app.migrate",
    factory: () => {
      builds += 1;
      return ping;
    },
  });
  const helped = await run({
    name: "app",
    version: "1.0.0",
    scope: { tags: [command("ping", migrate)] },
    argv: ["help"],
  });
  expect(helped.code).toBe(0);
  const unknown = await run({
    name: "app",
    version: "1.0.0",
    scope: { tags: [command("ping", migrate)] },
    argv: ["nope"],
  });
  expect(unknown.code).toBe(2);
  expect(builds).toBe(0);
});

test("an entry command bound to a resource receives the scope", async () => {
  const db = resource({ label: "db", factory: () => "real" });
  let seen: unknown;
  const serve = resource({
    label: "app.serve",
    factory: () => (scope: Scope.Handle) => {
      seen = scope.resolve(db);
    },
  });
  const result = await run({
    name: "app",
    version: "1.0.0",
    scope: { tags: [command.entry("serve", serve)] },
    argv: ["serve", "--port", "8080"],
  });
  expect(result.code).toBe(0);
  expect(seen).toBe("real");
});

test("io writers see the same streams the result collects", async () => {
  const seenOut: string[] = [];
  const seenErr: string[] = [];
  const result = await run({
    name: "app",
    version: "1.0.0",
    scope: { tags: [command("broken", () => broken)] },
    io: { stdout: (s) => seenOut.push(s), stderr: (s) => seenErr.push(s) },
    argv: ["broken"],
  });
  expect(result.code).toBe(1);
  expect(seenErr.join("")).toBe(result.stderr);
  expect(seenOut.join("")).toBe(result.stdout);
});

test("the process smoke test: node runs the example and help exits 0 with usage", async () => {
  const child = await new Promise<{ code: number; out: string; err: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      ["--experimental-strip-types", "examples/main.ts", "help"],
      { cwd: new URL("..", import.meta.url) },
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
