import { expect, test } from "vite-plus/test";
import { run } from "@tinker/process";
import { arithmetic, shell } from "./index.ts";

test("prints help when no command is given", async () => {
  expect(await run(shell, [])).toEqual({
    code: 0,
    stdout: "usage: tinker <command>\n  greet\n  ping\n",
    stderr: "",
  });
});

test("ping prints pong as a JSON line", async () => {
  expect(await run(shell, ["ping"])).toEqual({
    code: 0,
    stdout: '"pong"\n',
    stderr: "",
  });
});

test("greet reads the first name argument", async () => {
  expect(await run(shell, ["greet", "ada", "unused"])).toEqual({
    code: 0,
    stdout: "hello ada\n",
    stderr: "",
  });
});

test("greet without a name prints usage with code 2", async () => {
  expect(await run(shell, ["greet"])).toEqual({
    code: 2,
    stdout: "",
    stderr: "usage: tinker <command>\n  greet\n  ping\n",
  });
});

test("double prints twice the given number", async () => {
  expect(await run(arithmetic, ["double", "21"])).toEqual({
    code: 0,
    stdout: "42\n",
    stderr: "",
  });
});
