import { expect, test } from "vite-plus/test";
import { positionals } from "../src/index.ts";

test("positionals keeps the plain words in order and drops a --flag", () => {
  expect(positionals(["verify", "--json", "b.yaml", "src"])).toEqual(["verify", "b.yaml", "src"]);
});

test("a flag named in values drops its value too", () => {
  expect(positionals(["--key-file", "k", "b.yaml"], { values: ["--key-file"] })).toEqual([
    "b.yaml",
  ]);
});

test("--name=value is one flag, so it drops with no word after it", () => {
  expect(positionals(["--key-file=k", "b.yaml"], { values: ["--key-file"] })).toEqual(["b.yaml"]);
});

test("-- ends the flags, so every later word is plain", () => {
  expect(positionals(["ask", "--", "--flag", "b"], { values: ["--flag"] })).toEqual([
    "ask",
    "--flag",
    "b",
  ]);
});

test("positionals keeps a lone dash as a plain word and drops a single-dash flag", () => {
  expect(positionals(["-", "-x", "b"])).toEqual(["-", "b"]);
});

test("a value flag at the end with no next word drops nothing", () => {
  expect(positionals(["a", "--key-file"], { values: ["--key-file"] })).toEqual(["a"]);
});
