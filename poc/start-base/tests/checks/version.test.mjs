import { expect, test } from "vite-plus/test";
import { version } from "../../lib/checks/version.mjs";
import { basePackage } from "../../lib/paths.mjs";
import { fixture, goodApp } from "../fixture.mjs";

test("passes when the base resolves and every peer is the tested version", () => {
  expect(version(goodApp())).toEqual({
    status: "ok",
    lines: [`@tinker/start ${basePackage.version}; 4 peers match the tested versions`],
  });
});

test("fails when the base does not resolve", () => {
  expect(version(fixture({ "package.json": "{}" })).lines).toEqual([
    "@tinker/start does not resolve; add it to package.json and install",
  ]);
});

test("names each peer that drifted from the tested version, or is missing", () => {
  const root = goodApp({
    "node_modules/@tanstack/react-router/package.json": JSON.stringify({ version: "1.0.0" }),
    "node_modules/@tinker/react/package.json": "{}",
  });
  const tested = basePackage.tinker.tested;
  expect(version(root)).toMatchObject({
    status: "fail",
    lines: [
      `@tanstack/react-router is 1.0.0, tested with ${tested["@tanstack/react-router"]}`,
      `@tinker/react is missing, tested with ${tested["@tinker/react"]}`,
    ],
  });
});
