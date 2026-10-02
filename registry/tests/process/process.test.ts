import { operation, tag, extension } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { argv, env, io, jsonLine, run, type Process } from "../../src/process/index.ts";

const double = operation({
  label: "double",
  input: (raw: unknown) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error("need a number");
    return n;
  },
  run: (_deps, ctx) => ctx.input * 2,
});
const doubleCommand = operation({
  label: "double command",
  depends: { argv: argv.required, io: io.required, double },
  run: ({ argv, io, double }) => {
    io.write(jsonLine(double.run({ rawInput: argv[0] })) ?? "");
    return 0;
  },
});
const three = operation({
  label: "three",
  depends: { io: io.required },
  run: ({ io }) => {
    io.write("one ");
    io.write("two ");
    return 3;
  },
});
const show = operation({
  label: "show",
  depends: { argv: argv.required, env: env.required, io: io.required },
  run: ({ argv, env, io }) => {
    io.write(JSON.stringify({ args: argv, env }));
    return 0;
  },
});
const failure = tag<unknown>({ label: "failure" });
const fail = operation({
  label: "fail",
  depends: { failure: failure.required },
  run: ({ failure }): number => {
    throw failure;
  },
});

function shell(commands: readonly Process.Route[]): Process.Shell {
  return { name: "tk", version: "1.2.3", commands };
}
function route(name: string, op: Process.Command, description?: string): Process.Route {
  return { name, description, entry: () => ({ kind: "command", op }) };
}
async function collect(input: Omit<Process.RunOptions, "io">) {
  let stdout = "";
  let stderr = "";
  const code = await run({
    ...input,
    io: {
      write: (text) => {
        stdout += text;
      },
      error: (text) => {
        stderr += text;
      },
    },
  });
  return { code, stdout, stderr };
}

test("help sorts routes by name and preserves duplicate order without loading", async () => {
  const table = shell([
    {
      name: "zeta",
      entry: () => {
        throw new Error("must not load");
      },
    },
    route("alpha", three, "first"),
    route("middle", three),
    route("alpha", three, "second"),
    route("beta", three),
  ]);
  for (const args of [[], ["help"], ["--help"]]) {
    expect(await collect({ shell: table, args })).toEqual({
      code: 0,
      stdout: "usage: tk <command>\n  alpha  first\n  alpha  second\n  beta\n  middle\n  zeta\n",
      stderr: "",
    });
  }
});

test("version returns 0 without loading", async () => {
  expect(await collect({ shell: shell([]), args: ["--version"] })).toEqual({
    code: 0,
    stdout: "1.2.3\n",
    stderr: "",
  });
});

test("an unknown command prints usage to stderr with exit 2 and loads nothing", async () => {
  expect(
    await collect({
      shell: shell([
        {
          name: "double",
          entry: () => {
            throw new Error("must not load");
          },
        },
      ]),
      args: ["nope"],
    }),
  ).toEqual({ code: 2, stdout: "", stderr: "usage: tk <command>\n  double\n" });
});

test("a command parses argv through its operation and writes a JSON line", async () => {
  expect(
    await collect({ shell: shell([route("double", doubleCommand)]), args: ["double", "21"] }),
  ).toEqual({ code: 0, stdout: "42\n", stderr: "" });
});

test("an operation's parse failure prints usage to stderr with exit 2", async () => {
  expect(
    await collect({ shell: shell([route("double", doubleCommand)]), args: ["double", "x"] }),
  ).toEqual({ code: 2, stdout: "", stderr: "usage: tk <command>\n  double\n" });
});

test("a command returns its own code and writes directly to the supplied writers", async () => {
  const writes: string[] = [];
  const errors: string[] = [];
  const code = await run({
    shell: shell([route("three", three)]),
    args: ["three"],
    io: { write: (text) => writes.push(text), error: (text) => errors.push(text) },
  });
  expect({ code, writes, errors }).toEqual({ code: 3, writes: ["one ", "two "], errors: [] });
});

test.each([
  { failure: new Error("boom"), stderr: "Error: boom\n" },
  { failure: { why: "odd" }, stderr: '{"why":"odd"}\n' },
  { failure: undefined, stderr: "unknown\n" },
])("a command failure prints $stderr with exit 1", async (row) => {
  expect(
    await collect({
      shell: shell([route("fail", fail)]),
      args: ["fail"],
      options: { tags: failure(row.failure) },
    }),
  ).toEqual({ code: 1, stdout: "", stderr: row.stderr });
});

test("each run calls its selected loader with args and retries after failure", async () => {
  let loads = 0;
  const table = shell([
    {
      name: "double",
      entry: ({ args }) => {
        expect(args).toEqual(["2"]);
        loads += 1;
        if (loads === 1) throw new Error("no module");
        return { kind: "command", op: doubleCommand };
      },
    },
  ]);
  expect(await collect({ shell: table, args: ["double", "2"] })).toEqual({
    code: 1,
    stdout: "",
    stderr: "Error: no module\n",
  });
  expect(await collect({ shell: table, args: ["double", "2"] })).toEqual({
    code: 0,
    stdout: "4\n",
    stderr: "",
  });
  await collect({ shell: table, args: ["double", "2"] });
  expect(loads).toBe(3);
});

test("run binds the supplied args and env and otherwise uses an empty env", async () => {
  const table = shell([route("show", show)]);
  expect(
    await collect({ shell: table, args: ["show", "a", "--b"], env: { TK_PROBE: "yes" } }),
  ).toEqual({ code: 0, stdout: '{"args":["a","--b"],"env":{"TK_PROBE":"yes"}}', stderr: "" });
  expect(await collect({ shell: table, args: ["show"] })).toEqual({
    code: 0,
    stdout: '{"args":[],"env":{}}',
    stderr: "",
  });
});

test("entry options override common options and tags combine after process facts", async () => {
  const events: string[] = [];
  const common = extension({
    label: "common",
    hooks: {
      start: (event) => {
        events.push("common");
        return event.next();
      },
    },
  });
  const entry = extension({
    label: "entry",
    hooks: {
      start: (event) => {
        events.push("entry");
        return event.next();
      },
    },
  });
  expect(
    await collect({
      shell: shell([
        {
          name: "show",
          entry: () => ({
            kind: "command",
            op: show,
            options: { tags: env({ TK_PROBE: "entry" }), extensions: [entry] },
          }),
        },
      ]),
      args: ["show", "original"],
      env: { TK_PROBE: "facts" },
      options: { tags: [argv(["common"]), env({ TK_PROBE: "common" })], extensions: [common] },
    }),
  ).toEqual({ code: 0, stdout: '{"args":["common"],"env":{"TK_PROBE":"entry"}}', stderr: "" });
  expect(events).toEqual(["entry"]);
});

test("an already aborted call starts no loader and returns 130", async () => {
  let loads = 0;
  const result = await collect({
    shell: shell([
      {
        name: "show",
        entry: () => {
          loads += 1;
          return { kind: "command", op: show };
        },
      },
    ]),
    args: ["show"],
    signal: AbortSignal.abort(),
  });
  expect({ ...result, loads }).toEqual({ code: 130, stdout: "", stderr: "", loads: 0 });
});

test("a loader that aborts before returning starts no root", async () => {
  const controller = new AbortController();
  const starts: string[] = [];
  const started = extension({
    label: "started",
    hooks: {
      start: (event) => {
        starts.push("started");
        return event.next();
      },
    },
  });
  const result = await collect({
    shell: shell([
      {
        name: "show",
        entry: () => {
          controller.abort();
          return { kind: "command", op: show, options: { extensions: [started] } };
        },
      },
    ]),
    args: ["show"],
    signal: controller.signal,
  });
  expect({ ...result, starts }).toEqual({ code: 130, stdout: "", stderr: "", starts: [] });
});

test("a loader failure caused by abort returns 130 without error output", async () => {
  const controller = new AbortController();
  const result = await collect({
    shell: shell([
      {
        name: "show",
        entry: () => {
          controller.abort();
          throw controller.signal.reason;
        },
      },
    ]),
    args: ["show"],
    signal: controller.signal,
  });
  expect(result).toEqual({ code: 130, stdout: "", stderr: "" });
});

test("abort during loading returns 130 before the loader ends and observes its late rejection", async () => {
  const controller = new AbortController();
  let reject!: (error: unknown) => void;
  const loaded = new Promise<Process.Entry>((_resolve, fail) => {
    reject = fail;
  });
  let received: AbortSignal | undefined;
  const result = collect({
    shell: shell([
      {
        name: "wait",
        entry: ({ signal }) => {
          received = signal;
          return loaded;
        },
      },
    ]),
    args: ["wait"],
    signal: controller.signal,
  });
  controller.abort();
  expect(await result).toEqual({ code: 130, stdout: "", stderr: "" });
  expect(received).toBe(controller.signal);
  reject(new Error("late loader failure"));
});

test("jsonLine answers one JSON line and stays undefined for a void value", () => {
  expect(jsonLine({ n: 2 })).toBe('{"n":2}\n');
  expect(jsonLine(undefined)).toBe(undefined);
});
