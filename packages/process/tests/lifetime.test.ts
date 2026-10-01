import { data, extension, operation, resource, tag } from "@tinker/core";
import type { Scope } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { io, run, stop, type Process } from "../src/index.ts";

const record = tag<(event: string) => void>({ label: "record" });
const abortAtStart = tag<() => void>({ label: "abort at start" });
const cleanupFails = tag({ label: "cleanup fails", default: false });
const missing = tag<string>({ label: "required setting" });
const held = resource({
  label: "held",
  depends: { record: record.required, cleanupFails },
  factory: ({ record, cleanupFails }, ctx) => {
    ctx.defer((end) => {
      record(`released ${end.status}`);
      if (cleanupFails) throw new Error("cleanup failed");
    });
    return "held";
  },
});
const lifetime = extension({
  label: "lifetime",
  hooks: {
    start: (event) => {
      event.resolve(held);
      const abort = event.resolve(abortAtStart.optional);
      if (abort.present) abort.value();
      return event.next();
    },
    close: (event) => {
      event.resolve(record.required)(
        `close ${event.options.graceful === true ? "graceful" : "forced"}`,
      );
      return event.next();
    },
  },
});
const broken = extension({
  label: "broken setup",
  hooks: { start: (event) => event.resolve(missing.required) },
});
const commandCode = tag({ label: "command code", default: 0 });
const command = operation({
  label: "command",
  depends: { io: io.required, commandCode },
  run: ({ io, commandCode }) => {
    io.write("command ran");
    return commandCode;
  },
});
const failedCommand = operation({
  label: "failed command",
  run: (): number => {
    throw new Error("command failed");
  },
});
const began = tag<() => void>({ label: "began" });
const finish = tag<"return" | "reject" | "cancel">({ label: "finish" });
const hang = operation({
  label: "hang",
  depends: { began: began.required, finish: finish.required },
  run: ({ began, finish }, ctx) =>
    new Promise<number>((resolve, reject) => {
      ctx.signal.addEventListener(
        "abort",
        () => {
          if (finish === "return") resolve(7);
          else reject(finish === "reject" ? new Error("stopped") : ctx.signal.reason);
        },
        { once: true },
      );
      began();
    }),
});
const count = data({ label: "count", initial: 0 });
const write = operation({
  label: "write",
  depends: { count: count.controller },
  run: ({ count }) => {
    count.set(4);
    return 0;
  },
});

function gate<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function collect(entry: Process.Entry, signal?: AbortSignal, options?: Scope.Options) {
  const output: string[] = [];
  const errors: string[] = [];
  const code = await run({
    shell: { name: "tk", version: "1", commands: [{ name: "go", entry: () => entry }] },
    args: ["go"],
    signal,
    options,
    io: { write: (text) => output.push(text), error: (text) => errors.push(text) },
  });
  return { code, output, errors };
}

test("an abort during extension start exits 130 without running the command", async () => {
  const controller = new AbortController();
  const events: string[] = [];
  const result = await collect(
    {
      kind: "command",
      op: command,
      options: {
        extensions: [lifetime],
        tags: [record((event) => events.push(event)), abortAtStart(() => controller.abort())],
      },
    },
    controller.signal,
  );
  expect({ ...result, events }).toEqual({
    code: 130,
    output: [],
    errors: [],
    events: ["close forced", "released cancelled"],
  });
});

test("failed setup finishes cleanup and calls each close hook once", async () => {
  const events: string[] = [];
  const result = await collect({
    kind: "command",
    op: command,
    options: {
      extensions: [lifetime, broken],
      tags: record((event) => events.push(event)),
    },
  });
  expect({ ...result, events }).toEqual({
    code: 1,
    output: [],
    errors: ["Error: MissingTag\n"],
    events: ["close forced", "released failed"],
  });
});

test("a successful command returns 1 when cleanup fails", async () => {
  const events: string[] = [];
  const result = await collect({
    kind: "command",
    op: command,
    options: {
      extensions: [lifetime],
      tags: [record((event) => events.push(event)), cleanupFails(true)],
    },
  });
  expect({ ...result, events }).toEqual({
    code: 1,
    output: ["command ran"],
    errors: ["Error: cleanup failed\n"],
    events: ["close graceful", "released success"],
  });
});

test("cleanup failure keeps an earlier command exit code", async () => {
  const result = await collect({
    kind: "command",
    op: command,
    options: {
      extensions: [lifetime],
      tags: [record(() => {}), cleanupFails(true), commandCode(9)],
    },
  });
  expect(result).toEqual({ code: 9, output: ["command ran"], errors: ["Error: cleanup failed\n"] });
});

test("cleanup failure follows the primary command error without hiding it", async () => {
  const result = await collect({
    kind: "command",
    op: failedCommand,
    options: {
      extensions: [lifetime],
      tags: [record(() => {}), cleanupFails(true)],
    },
  });
  expect(result).toEqual({
    code: 1,
    output: [],
    errors: ["Error: command failed\n", "Error: cleanup failed\n"],
  });
});

test.each([
  { finish: "reject" as const, code: 130 },
  { finish: "return" as const, code: 7 },
])("command abort force-closes its root and respects $finish with code $code", async (row) => {
  const controller = new AbortController();
  const started = gate<void>();
  const events: string[] = [];
  const result = collect(
    {
      kind: "command",
      op: hang,
      options: {
        extensions: [lifetime],
        tags: [record((event) => events.push(event)), began(started.resolve), finish(row.finish)],
      },
    },
    controller.signal,
  );
  await started.promise;
  controller.abort();
  expect({ ...(await result), events }).toEqual({
    code: row.code,
    output: [],
    errors: [],
    events: ["close forced", "released cancelled"],
  });
});

test("a command with a signal writes to the root data its extensions read", async () => {
  const values: number[] = [];
  const observe = extension({
    label: "observe",
    hooks: {
      close: (event) => {
        values.push(event.resolve(count));
        return event.next();
      },
    },
  });
  const result = await collect(
    { kind: "command", op: write, options: { extensions: [observe] } },
    new AbortController().signal,
  );
  expect({ ...result, values }).toEqual({ code: 0, output: [], errors: [], values: [4] });
});

test("a service signal waits for graceful cleanup before returning 0", async () => {
  const controller = new AbortController();
  const started = gate<void>();
  const cleaned = gate<void>();
  const cleanupStarted = gate<void>();
  const outcomes: string[] = [];
  const service = extension({
    label: "service",
    hooks: {
      start: (event) => {
        event.defer((end) => {
          outcomes.push(end.status);
          cleanupStarted.resolve();
          return cleaned.promise;
        });
        started.resolve();
        return event.next();
      },
    },
  });
  let done = false;
  const result = collect(
    { kind: "service", options: { extensions: [service] } },
    controller.signal,
  ).then((value) => {
    done = true;
    return value;
  });
  await started.promise;
  controller.abort();
  await cleanupStarted.promise;
  expect(done).toBe(false);
  cleaned.resolve();
  expect({ ...(await result), outcomes }).toEqual({
    code: 0,
    output: [],
    errors: [],
    outcomes: ["success"],
  });
});

test("a service stop during startup finishes start and then cleans up", async () => {
  const events: string[] = [];
  const service = extension({
    label: "service",
    hooks: {
      start: async (event) => {
        event.defer(() => {
          events.push("closed");
        });
        event.resolve(stop.required)();
        await Promise.resolve();
        events.push("started");
        return event.next();
      },
    },
  });
  expect({
    ...(await collect({ kind: "service", options: { extensions: [service] } })),
    events,
  }).toEqual({ code: 0, output: [], errors: [], events: ["started", "closed"] });
});

test("a service whose start fails returns 1 after cleanup", async () => {
  const events: string[] = [];
  const result = await collect({
    kind: "service",
    options: {
      extensions: [lifetime, broken],
      tags: record((event) => events.push(event)),
    },
  });
  expect({ ...result, events }).toEqual({
    code: 1,
    output: [],
    errors: ["Error: MissingTag\n"],
    events: ["close forced", "released failed"],
  });
});

test("a service cleanup failure returns 1", async () => {
  const service = extension({
    label: "service",
    hooks: {
      start: (event) => {
        event.defer(() => {
          throw new Error("cleanup failed");
        });
        event.resolve(stop.required)();
        return event.next();
      },
    },
  });
  expect(await collect({ kind: "service", options: { extensions: [service] } })).toEqual({
    code: 1,
    output: [],
    errors: ["Error: cleanup failed\n"],
  });
});

test("a command cancelled by its own root returns 130 without an external signal", async () => {
  const started = gate<void>();
  let close!: () => Promise<Scope.Result>;
  const owner = extension({
    label: "owner",
    hooks: {
      start: (event) => {
        close = () => event.scope.close();
        return event.next();
      },
    },
  });
  const pending = collect({
    kind: "command",
    op: hang,
    options: {
      extensions: [owner],
      tags: [began(started.resolve), finish("cancel")],
    },
  });
  await started.promise;
  const ended = await close();
  expect({ ...(await pending), outcome: ended.status }).toEqual({
    code: 130,
    output: [],
    errors: [],
    outcome: "cancelled",
  });
});

test("an unexpected error in an owned service task returns 1 after startup", async () => {
  const started = gate<void>();
  const finish = gate<void>();
  const task = operation({
    label: "owned task",
    depends: { stop: stop.required },
    run: async ({ stop }) => {
      await finish.promise;
      stop();
      throw new Error("service task failed");
    },
  });
  const service = extension({
    label: "service",
    hooks: {
      start: (event) => {
        started.resolve(event.scope.ready);
        void event.run(task);
        return event.next();
      },
    },
  });
  const result = collect({ kind: "service", options: { extensions: [service] } });
  await started.promise;
  finish.resolve();
  expect(await result).toEqual({ code: 1, output: [], errors: ["Error: service task failed\n"] });
});
