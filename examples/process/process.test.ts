import { expect, test } from "vite-plus/test";
import { makeTestClock, type Clock } from "@tinker/core";
import { run, type Process } from "@tinker/process";
import { shell, tour } from "./index.ts";

test("prints help when no command is given", async () => {
  const result = await run(shell, []);
  expect(result).toEqual({
    code: 0,
    stdout:
      "usage: tk <command>\n  check  check a file\n  count  count up, streamed\n  lazy-check  check a file, loaded lazily\n  serve  tick until SIGINT\n",
    stderr: "",
  });
});

test("checks a file name", async () => {
  expect(await run(shell, ["check", "a.yaml"])).toEqual({
    code: 0,
    stdout: "checked a.yaml\n",
    stderr: "",
  });
});

test("loads the lazy command and prints one JSON line", async () => {
  expect(await run(shell, ["lazy-check", "a.yaml"])).toEqual({
    code: 0,
    stdout: '"checked a.yaml"\n',
    stderr: "",
  });
});

test("a missing file name is a usage error", async () => {
  const result = await run(shell, ["check"]);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("usage: tk <command>");
});

test("streams each count in order", async () => {
  const lines: string[] = [];
  await run(shell, ["count", "3"], { write: (line) => lines.push(line) });
  expect(lines).toEqual(["1 ", "2 ", "3 ", "\n"]);
});

test("rejects a count that cannot end", async () => {
  const result = await run(shell, ["count", "Infinity"]);
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
  const timedShell: Process.Shell = {
    ...shell,
    commands: shell.commands.map((route) => ({
      ...route,
      entry: async (args) => {
        const entry = await route.entry(args);
        return { ...entry, options: { ...entry.options, clock: tickingClock } };
      },
    })),
  };
  const pending = run(timedShell, ["serve"], undefined, stop.signal);
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

test("the tour stops serve once it starts", async () => {
  const results = await tour();
  expect(results.map((result) => result.code)).toEqual([0, 0, 0, 0]);
  expect(results.at(-1)?.stdout).toBe("listening\nstopped after 0 ticks\n");
});
