import { expect, test } from "vite-plus/test";
import { run, type Process } from "@tinker/process";
import { arithmetic, shell } from "./index.ts";

async function collect(input: Omit<Process.RunOptions, "io">) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run({
    ...input,
    io: { write: (text) => stdout.push(text), error: (text) => stderr.push(text) },
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

test("prints help when no command is given", async () => {
  expect(await collect({ shell, args: [] })).toEqual({
    code: 0,
    stdout: "usage: tinker <command>\n  greet\n  ping\n",
    stderr: "",
  });
});

test("ping prints pong as a JSON line", async () => {
  expect(await collect({ shell, args: ["ping"] })).toEqual({
    code: 0,
    stdout: '"pong"\n',
    stderr: "",
  });
});

test("greet reads the first name argument", async () => {
  expect(await collect({ shell, args: ["greet", "ada", "unused"] })).toEqual({
    code: 0,
    stdout: "hello ada\n",
    stderr: "",
  });
});

test("greet without a name prints usage with code 2", async () => {
  expect(await collect({ shell, args: ["greet"] })).toEqual({
    code: 2,
    stdout: "",
    stderr: "usage: tinker <command>\n  greet\n  ping\n",
  });
});

test("double prints twice the given number", async () => {
  expect(await collect({ shell: arithmetic, args: ["double", "21"] })).toEqual({
    code: 0,
    stdout: "42\n",
    stderr: "",
  });
});
