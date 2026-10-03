import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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

await test("create refuses a missing shape-only package even when lib loads", async () => {
  const root = mkdtempSync(join(tmpdir(), "jev-shape-package-"));
  try {
    const { tools, jev } = sourceCopy(root);
    const pkg = JSON.parse(readFileSync(join(jev, "package.json"), "utf8"));
    delete pkg.dependencies["@microsoft/tsdoc"];
    writeFileSync(join(jev, "package.json"), JSON.stringify(pkg));
    load(jev);
    const copy = await import(pathToFileURL(join(tools, "suite.mjs")).href);
    assert.throws(() => copy.freezeTrial(join(root, "trial"), "stock"), /Jev unavailable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test("create refuses a missing parser native binding even when lib loads", async () => {
  const root = mkdtempSync(join(tmpdir(), "jev-native-package-"));
  try {
    const { tools, jev } = sourceCopy(root);
    rmSync(join(jev, "node_modules"));
    const { freezeJevPackages } = await import("./jev-packages.mjs");
    freezeJevPackages(join(repoDir, "tools/jev"), jev);
    const parser = realpathSync(join(jev, "node_modules/oxc-parser"));
    const bindings = join(parser, "node_modules/@oxc-parser");
    for (const name of readdirSync(bindings)) rmSync(join(bindings, name));
    load(jev);
    const copy = await import(pathToFileURL(join(tools, "suite.mjs")).href);
    assert.throws(() => copy.freezeTrial(join(root, "trial"), "stock"), /Jev unavailable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test("create refuses an unavailable question bank even when lib loads", async () => {
  const root = mkdtempSync(join(tmpdir(), "jev-bank-package-"));
  try {
    const { tools, jev } = sourceCopy(root);
    writeFileSync(join(jev, "bank.mjs"), "import 'missing-bank-package';\n");
    load(jev);
    const copy = await import(pathToFileURL(join(tools, "suite.mjs")).href);
    assert.throws(() => copy.freezeTrial(join(root, "trial"), "stock"), /Jev unavailable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const failure of ["package copy", "module load"]) {
  await test(`failed ${failure} removes frozen so create can retry`, async () => {
    const root = mkdtempSync(join(tmpdir(), "jev-create-retry-"));
    try {
      const { tools, jev } = sourceCopy(root);
      const broken = join(jev, failure === "package copy" ? "package.json" : "lib.mjs");
      const original = readFileSync(broken);
      if (failure === "package copy") {
        const pkg = JSON.parse(original);
        pkg.dependencies["missing-jev-package"] = "0.0.0";
        writeFileSync(broken, JSON.stringify(pkg));
      } else writeFileSync(broken, "import 'missing-jev-package';\n");
      const trial = join(root, "trial");
      mkdirSync(trial);
      writeFileSync(join(trial, "keep.txt"), "keep me");
      const copy = await import(pathToFileURL(join(tools, "suite.mjs")).href);
      assert.throws(() => copy.freezeTrial(trial, "stock"), /Jev unavailable/);
      assert.equal(existsSync(join(trial, "frozen")), false);
      assert.equal(readFileSync(join(trial, "keep.txt"), "utf8"), "keep me");
      writeFileSync(broken, original);
      const frozen = copy.freezeTrial(trial, "stock");
      assert.equal(copy.verifyFrozen(trial, frozen), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

await test("frozen Jev loads after deleting an owned source copy of its packages", async () => {
  const root = mkdtempSync(join(tmpdir(), "jev-package-copy-"));
  try {
    const { source, tools, jev } = sourceCopy(root);
    rmSync(join(jev, "node_modules"));
    const { freezeJevPackages } = await import("./jev-packages.mjs");
    freezeJevPackages(join(repoDir, "tools/jev"), jev);
    assertOwnedLinks(jev, source);
    load(jev);
    const copy = await import(pathToFileURL(join(tools, "suite.mjs")).href);
    const trial = join(root, "trial");
    copy.freezeTrial(trial, "stock");
    rmSync(join(jev, "node_modules"), { recursive: true });
    load(join(trial, "frozen/jev"));
    load(join(trial, "frozen/jev"), "shape.mjs");
    assertOwnedLinks(join(trial, "frozen/jev"), trial);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const failure of ["broken package link", "missing shape-only package"]) {
  await test(`check records unavailable Jev and still runs own and teacher with ${failure}`, () => {
    const root = mkdtempSync(join(tmpdir(), "jev-check-"));
    try {
      const trial = join(root, ".local/share/tinker-writer-trial/temp-jev-check");
      const frozen = freezeTrial(trial, "stock");
      const modules = join(trial, "frozen/jev/node_modules");
      if (failure === "broken package link") {
        rmSync(modules, { recursive: true });
        symlinkSync(join(root, "deleted-checkout/node_modules"), modules);
      } else rmSync(join(modules, "@microsoft/tsdoc"));
      const archive = join(trial, "source.tar");
      execFileSync("tar", ["-cf", archive, "--files-from", "/dev/null"]);
      const manifest = join(trial, "manifest.json");
      writeFileSync(
        manifest,
        JSON.stringify({
          suite: "stock",
          frozen,
          image: `sha256:${"0".repeat(64)}`,
          workers: [{ attempts: [{ round: 1, attempt: 1, archive }] }],
        }),
      );
      // Use the real Docker CLI with no daemon. It cannot reach any live trial.
      const env = {
        ...process.env,
        HOME: root,
        DOCKER_CONFIG: join(root, "docker-config"),
        DOCKER_HOST: `unix://${join(root, "no-docker.sock")}`,
      };
      delete env.DOCKER_CONTEXT;
      delete env.DOCKER_TLS_VERIFY;
      const result = spawnSync(
        process.execPath,
        [join(trialDir, "review.mjs"), "check", "temp-jev-check", "1", "1"],
        { env, encoding: "utf8", timeout: 30000 },
      );
      assert.equal(result.status, 1);
      const attempt = JSON.parse(readFileSync(manifest, "utf8")).workers[0].attempts[0];
      assert.equal(attempt.checks?.length, 1);
      const check = attempt.checks[0];
      assert.equal(check.ownExit, 1);
      assert.equal(check.teacherExit, 1);
      assert.equal(check.jevExit, 1);
      assert.equal(check.jev, "unavailable");
      assert.equal(check.machine, "machine-fail");
      assert.equal(attempt.machine, "machine-fail");
      const report = JSON.parse(readFileSync(check.jevFile, "utf8"));
      assert.equal(report.gate.status, "unavailable");
      assert.match(report.gate.reasons.join("\n"), /Jev unavailable: frozen modules cannot load/);
      assert.match(readFileSync(check.ownLog, "utf8"), /Cannot connect to the Docker daemon/);
      assert.match(readFileSync(check.teacherLog, "utf8"), /Cannot connect to the Docker daemon/);
      assert.match(readFileSync(join(check.dir, "machine.txt"), "utf8"), /jev: 1 \(unavailable\)/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
