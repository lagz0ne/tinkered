import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectPlain } from "./plain.mjs";
import { gateOf } from "../writer-trial/gate.mjs";

const APP = "apps/tracker/src/main.ts";
const fixture = (name) =>
  readFileSync(new URL(`fixtures/lifetime-rules/${name}.txt`, import.meta.url), "utf8");
const lifetimeRows = (source, file = APP, writer = false) =>
  inspectPlain(source, file, { writer }).filter((r) => r.id === "S19" || r.id === "S29");
const ready = fixture("ready");
const stop = fixture("stop");

void describe("S19 repo lane", () => {
  const source = [
    'function runUntilStop(scope: Pick<Scope.Handle, "ready" | "close">) {}',
    "const save = (scope: Scope.RootHandle) => 1;",
    "type Input = { scope: Scope.RootHandle };",
    "function wrapped(input: Input) {}",
    "function render(root: Root) {}",
  ].join("\n");

  void it("checks roots and wrapped handle types in apps and examples", () => {
    for (const file of [APP, "examples/basic.ts", `/repo/${APP}`])
      assert.deepEqual(
        lifetimeRows(source, file).map((r) => [r.id, r.line]),
        [
          ["S19", 1],
          ["S19", 2],
          ["S19", 4],
        ],
        file,
      );
  });

  void it("keeps driver helpers and tests out of the repo lane, with the writer src lane intact", () => {
    for (const file of [
      "tools/blueprint/src/index.ts",
      "src/app.ts",
      "apps/tracker/scripts/build.ts",
    ])
      assert.deepEqual(lifetimeRows(source, file), [], file);
    assert.equal(lifetimeRows(source, "tools/blueprint/src/index.ts", true).length, 3);
    for (const file of [
      "apps/tracker/src/app.test.ts",
      "examples/tests/fixture.ts",
      "apps/start-scaffold/src/scaffold/backend/lifetime.spec.ts",
    ])
      for (const writer of [false, true])
        assert.deepEqual(lifetimeRows(source, file, writer), [], file);
  });
});

void describe("S29 lifetimeByHand", () => {
  void it("reports each ready catch at its close call, including named failure callbacks", () => {
    for (const writer of [false, true])
      assert.deepEqual(
        lifetimeRows(ready, APP, writer)
          .filter((r) => r.id === "S29")
          .map((r) => r.line),
        [6, 12, 16, 20, 26, 35, 41],
      );
  });

  void it("reports abort listeners and inline or local promise waits followed by graceful close", () => {
    for (const writer of [false, true])
      assert.deepEqual(
        lifetimeRows(stop, APP, writer).map((r) => [r.id, r.line]),
        [
          ["S29", 4],
          ["S29", 10],
          ["S29", 19],
          ["S29", 27],
          ["S29", 32],
          ["S29", 40],
        ],
      );
  });

  void it("leaves other owners, streams, sessions, forced stops, work cleanup, and hidden names alone", () => {
    for (const writer of [false, true])
      assert.deepEqual(
        lifetimeRows(fixture("near-misses"), APP, writer).filter((r) => r.id === "S29"),
        [],
      );
  });

  void it("checks ready in tests too and leaves every core file out of both lanes", () => {
    for (const file of [
      "apps/tracker/tests/fixture.ts",
      "apps/start-scaffold/tests/sync.test.ts",
      "src/app.spec.ts",
      "tests/app.browser.ts",
    ])
      for (const writer of [false, true]) {
        assert.equal(lifetimeRows(ready, file, writer).length, 7, file);
        assert.deepEqual(lifetimeRows(stop, file, writer), [], file);
      }
    for (const file of [
      "packages/core/src/index.ts",
      "packages/core/tests/lifetime.test.ts",
      "/repo/packages/core/tests/fixture.ts",
    ])
      for (const writer of [false, true])
        assert.deepEqual(
          lifetimeRows(ready + stop, file, writer).filter((r) => r.id === "S29"),
          [],
          file,
        );
  });

  void it("limits repo source checks to apps, examples, and packages, with all writer files checked", () => {
    for (const file of [
      APP,
      "examples/basic.ts",
      "tools/blueprint/tinker/process/index.ts",
      "packages/react/src/index.ts",
    ])
      assert.equal(lifetimeRows(stop, file).length, 6, file);
    for (const file of [
      "tools/boot.ts",
      "src/app.ts",
      "bench/boot.ts",
      "packages/process/scripts/boot.ts",
    ]) {
      assert.deepEqual(lifetimeRows(ready + stop, file), [], file);
      assert.equal(
        lifetimeRows(ready + stop, file, true).filter((r) => r.id === "S29").length,
        13,
        file,
      );
    }
  });

  void it("blocks the writer gate and prints both filled-in fixes", () => {
    const plainFindings = lifetimeRows(ready + stop, APP, true);
    const gate = gateOf({ file: APP, plainFindings, rows: [] });
    assert.equal(gate.status, "block");
    assert.match(
      gate.blocking.find((r) => r.rule === "S29").fix,
      /ready.*rejects only after the forced close ended and every close hook ran/,
    );
    assert.match(
      gate.blocking.at(-1).fix,
      /createScope\(\{ \.\.\.pieces, signal: stop \}\).*const end = await scope.closed/,
    );
  });

  void it("the repo lint prints only S29 for tests with an error assertion and React state", () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-lifetime-"));
    try {
      const file = join(dir, "ready.test.tsx");
      writeFileSync(
        file,
        ready +
          [
            'import { useState } from "react";',
            "function View() { const [value] = useState(0); return <p>{value}</p>; }",
            "expect(error).toBeInstanceOf(Error);",
          ].join("\n"),
      );
      const output = execFileSync(process.execPath, ["tools/jev/lint.mjs", file], {
        cwd: new URL("../../", import.meta.url),
        env: { ...process.env, AI_GATEWAY_API_KEY: "", JEV_TOKEN_FILE: "/dev/null" },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      assert.deepEqual(
        [...output.matchAll(/▪ L(\d+) ([\w.-]+):/g)].map((m) => [m[2], Number(m[1])]),
        [6, 12, 16, 20, 26, 35, 41].map((line) => ["S29", line]),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
