import { expect, test } from "vite-plus/test";
import { run } from "@tinker/process";
import { shell, tour } from "./index.ts";

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

test("the tour reports help, double, and ping results", async () => {
  expect(await tour()).toBe('help 0\ndouble 0: 42\nping 0: "pong"\n');
});
