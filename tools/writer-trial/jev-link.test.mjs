import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { freezeTrial, repoDir, trialDir } from "./suite.mjs";

const load = (dir, file = "lib.mjs") =>
  execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    "await import(process.argv[1])",
    pathToFileURL(join(dir, file)).href,
  ]);

function sourceCopy(root) {
  const source = join(root, "source");
  const tools = join(source, "tools/writer-trial");
  mkdirSync(tools, { recursive: true });
  for (const file of [
    "suite.mjs",
    "jev-packages.mjs",
    "config.json",
    "guidelines.md",
    "extension.mjs",
    "broker.mjs",
    "gate.mjs",
    "stock",
  ]) {
    if (existsSync(join(trialDir, file)))
      cpSync(join(trialDir, file), join(tools, file), { recursive: true });
  }
  const jev = join(source, "tools/jev");
  cpSync(join(repoDir, "tools/jev"), jev, {
    recursive: true,
    filter: (path) => !path.includes("node_modules"),
  });
  // A disposable checkout's installed package link. Never remove real packages.
  symlinkSync(join(repoDir, "tools/jev/node_modules"), join(jev, "node_modules"));
  return { source, tools, jev };
}

function assertOwnedLinks(dir, root) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (lstatSync(path).isSymbolicLink()) {
      assert.ok(realpathSync(path).startsWith(`${root}/`), `external package link: ${path}`);
    } else if (lstatSync(path).isDirectory()) assertOwnedLinks(path, root);
  }
}

await test("frozen Jev still loads after deleting the source checkout and its package link", async () => {
  const root = mkdtempSync(join(tmpdir(), "jev-link-"));
  try {
    const { source, tools, jev } = sourceCopy(root);
    load(jev);
    const trial = join(root, "trial");
    const copy = await import(pathToFileURL(join(tools, "suite.mjs")).href);
    copy.freezeTrial(trial, "stock");
    rmSync(source, { recursive: true });
    const frozenJev = join(trial, "frozen/jev");
    load(frozenJev);
    load(frozenJev, "shape.mjs");
    assertOwnedLinks(frozenJev, trial);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test("create refuses an unavailable frozen Jev before publishing a trial", async () => {
  const root = mkdtempSync(join(tmpdir(), "jev-create-"));
  try {
    const { tools, jev } = sourceCopy(root);
    writeFileSync(join(jev, "lib.mjs"), "import 'missing-jev-package';\n");
    const copy = await import(pathToFileURL(join(tools, "suite.mjs")).href);
    assert.throws(() => copy.freezeTrial(join(root, "trial"), "stock"), /Jev unavailable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test("check refuses unavailable Jev before running own or teacher containers", () => {
  const root = mkdtempSync(join(tmpdir(), "jev-check-"));
  try {
    const trial = join(root, ".local/share/tinker-writer-trial/temp-jev-check");
    const frozen = freezeTrial(trial, "stock");
    rmSync(join(trial, "frozen/jev/node_modules"), { recursive: true, force: true });
    writeFileSync(
      join(trial, "manifest.json"),
      JSON.stringify({
        suite: "stock",
        frozen,
        workers: [{ attempts: [{ round: 1, attempt: 1, archive: join(trial, "source.tar.gz") }] }],
      }),
    );
    const result = spawnSync(
      process.execPath,
      [join(trialDir, "review.mjs"), "check", "temp-jev-check", "1", "1"],
      { env: { ...process.env, HOME: root }, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Jev unavailable/);
    assert.equal(existsSync(join(trial, "check-1")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
