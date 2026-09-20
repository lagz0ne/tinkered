import { expect, test } from "vite-plus/test";
import { createScope, operation, type Scope } from "@tinker/core";
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

type Opened = { readonly scope: Scope.Handle; readonly run: Cli.Run };

/** Install the wiring on a scope and resolve its run: the root's hand, in hand. */
async function openScope(wiring: Cli.Wiring): Promise<Opened> {
  const ext = cli(wiring);
  const scope = createScope({ extensions: [ext] });
  await scope.ready;
  return { scope, run: scope.resolve(ext) };
}

test("--version answers the version with exit 0 and loads nothing", async () => {
  let loads = 0;
  const ext = cli({
    name: "app",
    version: "1.2.3",
    commands: [
      command("ping", () => {
        loads += 1;
        return ping;
      }),
    ],
  });
  const scope = createScope({ extensions: [ext] });
  await scope.ready;
  const result = await scope.resolve(ext)(["--version"]);
  await scope.close({ graceful: true });
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("1.2.3\n");
  expect(result.stderr).toBe("");
  expect(loads).toBe(0);
});

test("the root outlives a throwing run: the next command still answers", async () => {
  const fail = operation({
    label: "fail",
    run: () => {
      throw new Error("bad");
    },
  });
  const { scope, run } = await openScope({
    name: "app",
    version: "1.0.0",
    commands: [command("fail", () => fail), command("ping", () => ping)],
  });
  const bad = await run(["fail"]);
  const good = await run(["ping"]);
  await scope.close({ graceful: true });
  expect(bad.code).toBe(1);
  expect(good.code).toBe(0);
  expect(good.stdout).toBe('"pong"\n');
});

test("a custom error object prints as JSON with exit 1", async () => {
  const fail = operation({
    label: "fail",
    run: () => {
      throw { problem: "gone" };
    },
  });
  const { scope, run } = await openScope({
    name: "app",
    version: "1.0.0",
    commands: [command("fail", () => fail)],
  });
  const result = await run(["fail"]);
  await scope.close({ graceful: true });
  expect(result.code).toBe(1);
  expect(result.stderr).toBe('{"problem":"gone"}\n');
});

test("a throwing loader surfaces as the run failure with exit 1", async () => {
  const { scope, run } = await openScope({
    name: "app",
    version: "1.0.0",
    commands: [
      command("late", () => {
        throw new Error("no module");
      }),
    ],
  });
  const result = await run(["late"]);
  await scope.close({ graceful: true });
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("no module");
});

test("usage sorts the bound names", async () => {
  const { scope, run } = await openScope({
    name: "app",
    version: "1.0.0",
    commands: [command("zebra", () => ping), command("apple", () => ping)],
  });
  const result = await run(["help"]);
  await scope.close({ graceful: true });
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("app 1.0.0\n  apple\n  zebra\n");
});

test("a loader throw is not cached: the next selection retries", async () => {
  let calls = 0;
  const { scope, run } = await openScope({
    name: "app",
    version: "1.0.0",
    commands: [
      command(
        "flaky",
        () => {
          calls += 1;
          if (calls === 1) throw new Error("first load fails");
          return double;
        },
        { input: (argv) => argv[0] },
      ),
    ],
  });
  const first = await run(["flaky", "21"]);
  const third = await run(["flaky", "21"]);
  await scope.close({ graceful: true });
  expect(first.code).toBe(1);
  expect(first.stderr).toContain("first load fails");
  expect(third.code).toBe(0);
  expect(third.stdout).toBe("42\n");
  expect(calls).toBe(2);
});
