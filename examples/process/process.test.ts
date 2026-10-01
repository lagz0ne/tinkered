import { expect, test } from "vite-plus/test";
import { makeTestClock, type Clock } from "@tinker/core";
import { run, type Process } from "@tinker/process";
import { shell } from "./index.ts";

async function collect(input: Omit<Process.RunOptions, "shell" | "io">) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run({
    ...input,
    shell,
    io: { write: (text) => stdout.push(text), error: (text) => stderr.push(text) },
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

test("prints help when no command is given", async () => {
  const result = await collect({ args: [] });
  expect(result).toEqual({
    code: 0,
    stdout:
      "usage: tk <command>\n  check  check a file\n  count  count up, streamed\n  lazy-check  check a file, loaded lazily\n  serve  tick until SIGINT\n",
    stderr: "",
  });
});

test("checks a file name", async () => {
  expect(await collect({ args: ["check", "a.yaml"] })).toEqual({
    code: 0,
    stdout: "checked a.yaml\n",
    stderr: "",
  });
});

test("loads the lazy command and prints one JSON line", async () => {
  expect(await collect({ args: ["lazy-check", "a.yaml"] })).toEqual({
    code: 0,
    stdout: '"checked a.yaml"\n',
    stderr: "",
  });
});

test("a missing file name is a usage error", async () => {
  const result = await collect({ args: ["check"] });
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("usage: tk <command>");
});

test("streams each count in order", async () => {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await run({
    shell,
    args: ["count", "3"],
    io: { write: (line) => lines.push(line), error: (line) => errors.push(line) },
  });
  expect({ code, lines, errors }).toEqual({ code: 0, lines: ["1 ", "2 ", "3 ", "\n"], errors: [] });
});

test("rejects a count that cannot end", async () => {
  const result = await collect({ args: ["count", "Infinity"] });
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("usage: tk <command>");
});

test("stops serve and reports its completed ticks", async () => {
  const clock = makeTestClock();
  const stop = new AbortController();
  const firstSleep = Promise.withResolvers<void>();
  const nextSleep = Promise.withResolvers<void>();
  let signalSleep = firstSleep.resolve;
  const tickingClock: Clock.Handle = {
    ...clock,
    sleep: (ms, signal) => {
      const pending = clock.sleep(ms, signal);
      signalSleep();
      signalSleep = nextSleep.resolve;
      return pending;
    },
  };
  const pending = collect({
    args: ["serve"],
    signal: stop.signal,
    options: { clock: tickingClock },
  });
  await firstSleep.promise;
  clock.advance(10);
  await nextSleep.promise;
  stop.abort();
  expect(await pending).toEqual({
    code: 0,
    stdout: "listening\nstopped after 1 ticks\n",
    stderr: "",
  });
});
