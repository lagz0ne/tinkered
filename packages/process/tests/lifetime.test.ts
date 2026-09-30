import { extension, operation, resource, tag } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { execute, io } from "../src/index.ts";

const record = tag<(event: string) => void>({ label: "record" });
const abortAtStart = tag<() => void>({ label: "abort at start" });
const missing = tag<string>({ label: "required setting" });
const held = resource({
  label: "held",
  depends: { record: record.required },
  factory: ({ record }, ctx) => {
    ctx.defer((end) => record(`released ${end.status}`));
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
const command = operation({
  label: "command",
  depends: { io: io.required },
  run: ({ io }) => {
    io.write("command ran");
    return 0;
  },
});

test("an abort during extension start exits 130 without running the command", async () => {
  const stop = new AbortController();
  const events: string[] = [];
  const output: string[] = [];
  const code = await execute(
    {
      op: command,
      options: {
        extensions: [lifetime],
        tags: [record((event) => events.push(event)), abortAtStart(() => stop.abort())],
      },
    },
    [],
    { write: (text) => output.push(text), error: (text) => output.push(text) },
    { signal: stop.signal },
  );
  expect({ code, output, events }).toEqual({
    code: 130,
    output: [],
    events: ["close forced", "released cancelled"],
  });
});

test("failed setup finishes cleanup and calls each close hook once", async () => {
  const events: string[] = [];
  const output: string[] = [];
  const errors: string[] = [];
  const code = await execute(
    {
      op: command,
      options: {
        extensions: [lifetime, broken],
        tags: record((event) => events.push(event)),
      },
    },
    [],
    { write: (text) => output.push(text), error: (text) => errors.push(text) },
  );
  expect({ code, output, errors, events }).toEqual({
    code: 1,
    output: [],
    errors: ["Error: MissingTag\n"],
    events: ["close forced", "released failed"],
  });
});
