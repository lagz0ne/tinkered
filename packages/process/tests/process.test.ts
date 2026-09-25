import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import {
  createScope,
  extension,
  isError as isCoreError,
  operation,
  resource,
  tag,
} from "@tinker/core";
import {
  argv,
  env,
  execute,
  io,
  isError,
  jsonLine,
  main,
  run,
  type Process,
} from "../src/index.ts";

/** Collects what a no-process run wrote. */
const seenWrite: string[] = [];

/** A binary over the given routes. */
function shell(commands: readonly Process.Route[]): Process.Shell {
  return { name: "tk", version: "1.2.3", commands };
}

/** An operation that doubles a number parsed from argv. */
const double = operation({
  label: "double",
  input: (raw: unknown) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error("need a number");
    return n;
  },
  run: (_deps, ctx) => ctx.input * 2,
});

/** One `double` command over any `double` operation: parse argv[0], run, write the line, own
 * the code. The lazy route reuses it with the loaded operation. */
function doubleCommandFor(label: string, flow: typeof double): Process.Command {
  return operation({
    label,
    depends: { argv: argv.required, io: io.required, double: flow },
    run: ({ argv: args, io: out, double: op }) => {
      const value = op.run({ rawInput: args[0] });
      out.write(jsonLine(value) ?? "");
      return 0;
    },
  });
}

/** The `double` command, declared by its author: parse argv[0], run, write the line, own the code. */
const doubleCommand = doubleCommandFor("double", double);

/** A command that answers its own code and writes through the io tag as it goes. */
const three = operation({
  label: "three",
  depends: { io: io.required },
  run: ({ io: out }) => {
    out.write("one ");
    out.write("two ");
    return 3;
  },
});

/** A route whose `entry` awaits a lazy loader on first selection — memoized on success,
 * retried after a rejection. A dynamic `import` in practice; a function here. */
function lazyRoute(
  name: string,
  load: () => typeof double | PromiseLike<typeof double>,
): Process.Route {
  let cached: Promise<typeof double> | undefined;
  const once = (): Promise<typeof double> => {
    cached ??= Promise.resolve(load()).catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
    return cached;
  };
  return { name, entry: async () => ({ op: doubleCommandFor(name, await once()) }) };
}

/** A one-shot that never answers until the signal fires — a model call that hangs. */
const hang = operation({
  label: "hang",
  run: (_deps, ctx) =>
    new Promise<number>((_resolve, reject) => {
      ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
    }),
});

/** A server: returns its own code when the signal fires — SIGINT is its normal stop. */
const serve = operation({
  label: "serve",
  run: (_deps, ctx) =>
    new Promise<number>((resolve) => {
      ctx.signal.addEventListener("abort", () => resolve(0), { once: true });
    }),
});

/** A command over a plain route: `entry` answers the operation, `run` supplies the root. */
function routeFor(name: string, op: Process.Command, description?: string): Process.Route {
  return { name, description, entry: () => ({ op }) };
}

/** A signal that aborts after `ms`, on a real timer so the loop stays alive. */
function later(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("SIGINT")), ms);
  return controller.signal;
}

test("help lists the routes sorted with their descriptions and loads nothing", async () => {
  let loads = 0;
  const table = shell([
    {
      name: "zeta",
      description: "last",
      entry: () => {
        loads += 1;
        return { op: doubleCommand };
      },
    },
    routeFor("alpha", doubleCommand, "first"),
  ]);
  const result = await run(table, ["help"]);
  expect(result).toEqual({
    code: 0,
    stdout: "usage: tk <command>\n  alpha  first\n  zeta  last\n",
    stderr: "",
  });
  expect((await run(table, [])).code).toBe(0);
  expect(loads).toBe(0);
});

test("--help prints the usage with exit 0", async () => {
  const result = await run(shell([routeFor("double", doubleCommand, "twice")]), ["--help"]);
  expect(result).toEqual({
    code: 0,
    stdout: "usage: tk <command>\n  double  twice\n",
    stderr: "",
  });
});

test("help orders the routes by name whatever order they were declared in", async () => {
  const table = shell([
    routeFor("middle", three, "middle"),
    routeFor("alpha", three, "first"),
    routeFor("zeta", three, "last"),
    routeFor("beta", three, "second"),
  ]);
  expect((await run(table, ["help"])).stdout).toBe(
    "usage: tk <command>\n  alpha  first\n  beta  second\n  middle  middle\n  zeta  last\n",
  );
});

test("help lists routes that share a name in declared order", async () => {
  const table = shell([routeFor("same", three, "first"), routeFor("same", three, "second")]);
  expect((await run(table, ["help"])).stdout).toBe(
    "usage: tk <command>\n  same  first\n  same  second\n",
  );
});

test("--version answers the version with exit 0", async () => {
  expect(await run(shell([]), ["--version"])).toEqual({ code: 0, stdout: "1.2.3\n", stderr: "" });
});

test("an unknown command prints usage to stderr with exit 2 and loads nothing", async () => {
  let loads = 0;
  const table = shell([
    {
      name: "d",
      entry: () => {
        loads += 1;
        return { op: doubleCommand };
      },
    },
  ]);
  const result = await run(table, ["nope"]);
  expect(result.code).toBe(2);
  expect(result.stderr).toBe("usage: tk <command>\n  d\n");
  expect(loads).toBe(0);
});

test("a declared command parses argv through the operation's own parse and answers one JSON line", async () => {
  const result = await run(shell([routeFor("double", doubleCommand)]), ["double", "21"]);
  expect(result).toEqual({ code: 0, stdout: "42\n", stderr: "" });
});

test("the author owns the output: a custom line, and a void operation prints nothing", async () => {
  const loud = operation({
    label: "double",
    depends: { argv: argv.required, io: io.required, double },
    run: ({ argv: args, io: out, double: flow }) => {
      out.write(`= ${flow.run({ rawInput: args[0] })}\n`);
      return 0;
    },
  });
  const quiet = operation({
    label: "quiet",
    depends: { io: io.required },
    run: ({ io: out }) => {
      out.write(jsonLine(undefined) ?? "");
      return 0;
    },
  });
  const table = shell([routeFor("double", loud), routeFor("quiet", quiet)]);
  expect((await run(table, ["double", "4"])).stdout).toBe("= 8\n");
  expect(await run(table, ["quiet"])).toEqual({ code: 0, stdout: "", stderr: "" });
});

test("an operation's parse failure prints usage to stderr with exit 2", async () => {
  const result = await run(shell([routeFor("double", doubleCommand)]), ["double", "x"]);
  expect(result.code).toBe(2);
  expect(result.stderr).toBe("usage: tk <command>\n  double\n");
});

test("execute without options answers 2 on a parse failure and prints no usage", async () => {
  let stderr = "";
  const code = await execute({ op: doubleCommand }, ["x"], {
    write: () => undefined,
    error: (s) => {
      stderr += s;
    },
  });
  expect(code).toBe(2);
  expect(stderr).toBe("");
});

test("a throwing operation prints its error to stderr with exit 1", async () => {
  const boom = operation({
    label: "boom",
    run: (): number => {
      throw new Error("boom");
    },
  });
  const result = await run(shell([routeFor("boom", boom)]), ["boom"]);
  expect(result).toEqual({ code: 1, stdout: "", stderr: "Error: boom\n" });
});

test("a command whose dependency panics or raises exits 1 and its root still closes success", async () => {
  const ends: string[] = [];
  const probe = resource({
    label: "probe",
    factory: (_deps, ctx) => {
      ctx.defer((end) => void ends.push(end.status));
      return true;
    },
  });
  const panic = operation({
    label: "panic",
    run: (): number => {
      throw new Error("bug");
    },
  });
  const refused = operation({
    label: "refused",
    run: (_deps, ctx): number => ctx.raise("Refused", { why: "no" }),
  });
  const over = (label: string, dependency: typeof panic): Process.Command =>
    operation({ label, depends: { probe, dependency }, run: ({ dependency: d }) => d.run() });
  const table = shell([
    routeFor("panic", over("panicky", panic)),
    routeFor("refused", over("refusing", refused)),
  ]);
  expect(await run(table, ["panic"])).toEqual({ code: 1, stdout: "", stderr: "Error: bug\n" });
  expect(await run(table, ["refused"])).toEqual({
    code: 1,
    stdout: "",
    stderr: "Error: Refused\n",
  });
  expect(ends).toEqual(["success", "success"]);
});

test("a throwing loader is the run's failure with exit 1 and the next run retries it", async () => {
  let calls = 0;
  const table = shell([
    lazyRoute("flaky", () => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("no module"));
      return double;
    }),
  ]);
  const first = await run(table, ["flaky", "2"]);
  expect(first).toEqual({ code: 1, stdout: "", stderr: "Error: no module\n" });
  expect((await run(table, ["flaky", "2"])).stdout).toBe("4\n");
  expect(calls).toBe(2);
});

test("the selected loader runs once across two runs", async () => {
  let loads = 0;
  const table = shell([
    lazyRoute("d", () => {
      loads += 1;
      return double;
    }),
  ]);
  await run(table, ["d", "1"]);
  await run(table, ["d", "1"]);
  expect(loads).toBe(1);
});

test("a command answers its own exit code and its io writes are collected in order", async () => {
  const seen: string[] = [];
  const table = shell([{ name: "three", entry: () => ({ op: three }) }]);
  const result = await run(table, ["three"], { write: (s) => seen.push(s) });
  expect(result).toEqual({ code: 3, stdout: "one two ", stderr: "" });
  expect(seen).toEqual(["one ", "two "]);
});

test("a run given only an error writer still collects stdout", async () => {
  const table = shell([routeFor("double", doubleCommand)]);
  expect(await run(table, ["double", "4"], { error: () => undefined })).toEqual({
    code: 0,
    stdout: "8\n",
    stderr: "",
  });
});

test("a run given only a write writer still collects stderr", async () => {
  const table = shell([routeFor("double", doubleCommand)]);
  expect(await run(table, ["nope"], { write: () => undefined })).toEqual({
    code: 2,
    stdout: "",
    stderr: "usage: tk <command>\n  double\n",
  });
});

test("an entry's own options bind tags and extensions on that command's root only", async () => {
  const flavor = tag<string>({ label: "flavor" });
  const seen: string[] = [];
  const spy = extension({
    label: "spy",
    start: (_scope, _ctx, next) => {
      seen.push("started");
      return next();
    },
  });
  const tell = operation({
    label: "tell",
    depends: { flavor: flavor.optional, io: io.required },
    run: ({ flavor: f, io: out }) => {
      out.write(f.present ? f.value : "none");
      return 0;
    },
  });
  const table = shell([
    { name: "plain", entry: () => ({ op: tell }) },
    {
      name: "spiced",
      entry: () => ({ op: tell, options: { tags: [flavor("mint")], extensions: [spy] } }),
    },
  ]);
  expect((await run(table, ["plain"])).stdout).toBe("none");
  expect(seen).toEqual([]);
  expect((await run(table, ["spiced"])).stdout).toBe("mint");
  expect(seen).toEqual(["started"]);
});

test("the argv and env tags carry the rest of argv and the process environment", async () => {
  process.env["TK_PROBE"] = "yes";
  const show = operation({
    label: "show",
    depends: { argv: argv.required, env: env.required, io: io.required },
    run: ({ argv: a, env: e, io: out }) => {
      out.write(`${a.join("+")} ${e["TK_PROBE"] ?? "?"}`);
      return 0;
    },
  });
  const result = await run(shell([{ name: "show", entry: () => ({ op: show }) }]), [
    "show",
    "a",
    "--b",
  ]);
  expect(result.stdout).toBe("a+--b yes");
});

/** Each process tag with the label a missing-tag error names it by. */
const processTags = [
  [io, "process.io"],
  [argv, "process.argv"],
  [env, "process.env"],
] as const;

test.each(processTags)(
  "a command run outside a process run fails with MissingTag naming the process tag",
  (processTag, label) => {
    const cmd = operation({
      label: "probe",
      depends: { probe: processTag.required },
      run: () => 0,
    });
    try {
      createScope().run(cmd);
      expect.unreachable();
    } catch (error: unknown) {
      if (!isCoreError(error, "MissingTag")) throw error;
      expect(error.payload.label).toBe(label);
    }
  },
);

test("a command that answers closes its root gracefully", async () => {
  const modes: (boolean | undefined)[] = [];
  const spy = extension({
    label: "spy",
    close: (options, next) => {
      modes.push(options.graceful);
      return next();
    },
  });
  const quiet = operation({ label: "quiet", run: () => 0 });
  const table = shell([
    { name: "quiet", entry: () => ({ op: quiet, options: { extensions: [spy] } }) },
  ]);
  expect((await run(table, ["quiet"])).code).toBe(0);
  expect(modes).toEqual([true]);
});

test("an abort force-closes the root and a cancelled one-shot exits 130", async () => {
  const started = Date.now();
  const result = await run(
    shell([{ name: "hang", entry: () => ({ op: hang }) }]),
    ["hang"],
    undefined,
    later(20),
  );
  expect(result).toEqual({ code: 130, stdout: "", stderr: "" });
  expect(Date.now() - started).toBeLessThan(2000);
});

test("a server that returns on the signal exits with its own code, not 130", async () => {
  const result = await run(
    shell([{ name: "serve", entry: () => ({ op: serve }) }]),
    ["serve"],
    undefined,
    later(20),
  );
  expect(result.code).toBe(0);
});

test("an already-aborted signal exits 130 with empty streams and no root", async () => {
  let roots = 0;
  const spy = extension({
    label: "spy",
    start: (_s, _c, next) => {
      roots += 1;
      return next();
    },
  });
  const controller = new AbortController();
  controller.abort();
  const code = await execute(
    { op: three, options: { extensions: [spy] } },
    [],
    { write: () => undefined, error: () => undefined },
    { signal: controller.signal },
  );
  expect(code).toBe(130);
  expect(roots).toBe(0);
});

test("a throwing run leaves the next run unaffected", async () => {
  const boom = operation({
    label: "boom",
    run: (): number => {
      throw new Error("boom");
    },
  });
  const table = shell([routeFor("boom", boom), routeFor("double", doubleCommand)]);
  expect((await run(table, ["boom"])).code).toBe(1);
  expect(await run(table, ["double", "5"])).toEqual({ code: 0, stdout: "10\n", stderr: "" });
});

/** The process, faked at the boundary the package already reads through `globalThis`. */
type FakeProc = {
  argv: string[];
  env: Record<string, string | undefined>;
  exit(code: number): never;
  on(event: string, listener: () => void): unknown;
  emit(event: string): void;
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
};

/** Swap `globalThis.process` for one run, restore it after; answer what `main` did. */
async function underFakeProcess(
  argv: readonly string[],
  body: (shell: Process.Shell, proc: FakeProc) => Promise<never>,
  table: Process.Shell,
): Promise<{ code: number; out: string; err: string; events: string[] }> {
  const real = (globalThis as { process?: unknown }).process;
  const out: string[] = [];
  const err: string[] = [];
  const events: string[] = [];
  const listeners = new Map<string, (() => void)[]>();
  let code = -1;
  const exited = new Error("exited");
  const fake: FakeProc = {
    argv: ["node", "tk", ...argv],
    env: { TK_FAKE: "1" },
    exit: (n: number): never => {
      code = n;
      throw exited;
    },
    on: (event: string, listener: () => void) => {
      events.push(event);
      listeners.set(event, (listeners.get(event) ?? []).concat(listener));
    },
    emit: (event: string) => {
      for (const listener of listeners.get(event) ?? []) listener();
    },
    stdout: { write: (s: string) => out.push(s) },
    stderr: { write: (s: string) => err.push(s) },
  };
  (globalThis as { process?: unknown }).process = fake;
  try {
    await body(table, fake);
  } catch (error: unknown) {
    if (error !== exited) throw error;
  } finally {
    (globalThis as { process?: unknown }).process = real;
  }
  return { code, out: out.join(""), err: err.join(""), events };
}

test("main reads argv off the process, writes to its streams, wires both signals, and exits with the code", async () => {
  const table = shell([routeFor("double", doubleCommand)]);
  const ran = await underFakeProcess(["double", "8"], (s) => main(s), table);
  expect(ran).toEqual({ code: 0, out: "16\n", err: "", events: ["SIGINT", "SIGTERM"] });
});

test("main passes explicit args through instead of the process argv", async () => {
  const table = shell([routeFor("double", doubleCommand)]);
  const ran = await underFakeProcess(["double", "8"], (s) => main(s, ["double", "1"]), table);
  expect(ran.out).toBe("2\n");
});

test("main turns a fired signal into one abort of the run", async () => {
  const quit = operation({ label: "quit", run: () => 0 });
  const table = shell([routeFor("quit", quit)]);
  const ran = await underFakeProcess(
    ["quit"],
    async (s, proc) => {
      const pending = main(s);
      proc.emit("SIGINT");
      return pending;
    },
    table,
  );
  expect(ran.code).toBe(130);
});

test("main exits 2 on an unknown command and prints usage to the process stderr", async () => {
  const ran = await underFakeProcess(
    ["nope"],
    (s) => main(s),
    shell([routeFor("d", doubleCommand)]),
  );
  expect(ran.code).toBe(2);
  expect(ran.err).toBe("usage: tk <command>\n  d\n");
});

test("main without a process raises NoProcess, which isError narrows and rejects other kinds", async () => {
  const real = (globalThis as { process?: unknown }).process;
  (globalThis as { process?: unknown }).process = undefined;
  try {
    await main(shell([]));
    expect.unreachable();
  } catch (error: unknown) {
    if (!isError(error, "NoProcess")) throw error;
    expect(error.payload.reason.length).toBeGreaterThan(0);
    expect(isError(new Error("plain"), "NoProcess")).toBe(false);
  } finally {
    (globalThis as { process?: unknown }).process = real;
  }
});

test("a command that throws a non-Error prints it as JSON with exit 1", async () => {
  const odd = operation({
    label: "odd",
    run: (): number => {
      throw { why: "odd" };
    },
  });
  const result = await run(shell([routeFor("odd", odd)]), ["odd"]);
  expect(result).toEqual({ code: 1, stdout: "", stderr: '{"why":"odd"}\n' });
});

test("a command that throws undefined prints unknown with exit 1", async () => {
  const nothing = operation({
    label: "nothing",
    run: (): number => {
      throw undefined;
    },
  });
  const result = await run(shell([routeFor("nothing", nothing)]), ["nothing"]);
  expect(result).toEqual({ code: 1, stdout: "", stderr: "unknown\n" });
});

test("the env tag reads an empty record when there is no process", async () => {
  const real = (globalThis as { process?: unknown }).process;
  (globalThis as { process?: unknown }).process = undefined;
  const show = operation({
    label: "show",
    depends: { env: env.required, io: io.required },
    run: ({ env: e, io: out }) => {
      out.write(JSON.stringify(e));
      return 0;
    },
  });
  try {
    const code = await execute({ op: show }, [], {
      write: (s) => void seenWrite.push(s),
      error: () => undefined,
    });
    expect(code).toBe(0);
    expect(seenWrite.join("")).toBe("{}");
  } finally {
    (globalThis as { process?: unknown }).process = real;
  }
});

test("jsonLine answers one JSON line and stays undefined for a void value", () => {
  expect(jsonLine({ n: 2 })).toBe('{"n":2}\n');
  expect(jsonLine(undefined)).toBe(undefined);
});

/** The repo root: the nearest ancestor holding `pnpm-workspace.yaml`. Stryker copies this file
 * into a sandbox two levels deeper, so a fixed `../../..` would miss the examples there. */
function workspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) dir = dirname(dir);
  return dir;
}

test("the process smoke test: node runs the example and help exits 0 with its usage", async () => {
  const child = await new Promise<{ code: number; out: string; err: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      ["--experimental-strip-types", "process-cli/main.ts", "help"],
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
  expect(child.out).toBe("usage: tinker <command>\n  greet\n  ping\n");
});
