import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { releaseUrls } from "./release-urls.mjs";

/** Real tarballs over HTTP into an empty npm app. Core and React only; no Start. */
const root = resolve(import.meta.dirname, "..");
const core = JSON.parse(await readFile(join(root, "packages/core/package.json"), "utf8"));
const version = core.version;
const tag = `v${version}`;

const scratch = await mkdtemp(join(tmpdir(), "tinker-github-release-proof-"));
const mirror = join(scratch, "mirror");
const consumer = join(scratch, "app");
await mkdir(mirror);
await mkdir(consumer);
const servers = [];
const env = { ...process.env, CI: "true", npm_config_audit: "false", npm_config_fund: "false" };
console.log(`Proof folder: ${scratch}`);
console.log(`Version ${version}, tag ${tag}, from packages/core/package.json.`);

function run(command, args, cwd = root, expected = 0) {
  console.log(`\n$ ${command} ${args.join(" ")} (cwd ${cwd})`);
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 600000 });

  process.stdout.write((result.stdout ?? "").replaceAll("\0", ""));
  process.stdout.write((result.stderr ?? "").replaceAll("\0", ""));
  console.log(`EXIT ${result.status}`);

  assert.equal(result.status, expected, String(result.error ?? command));
  return result.stdout + result.stderr;
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const ended = new Promise((done) => child.once("exit", done));
  child.kill("SIGTERM");
  await ended;
  console.log(`Stopped server PID ${child.pid}.`);
}

try {
  run(process.execPath, ["scripts/release.mjs", version, "--dry"]);
  const release = join(root, ".release", tag);
  const manifest = JSON.parse(await readFile(join(release, "manifest.json"), "utf8"));
  assert.deepEqual(
    manifest.assets.map((asset) => [asset.file, asset.url]),
    Object.entries(releaseUrls(version)).map(([name, url]) => [
      `${name.replace("@tinker/", "tinker-")}-${version}.tgz`,
      url,
    ]),
  );
  console.log(`PASS: manifest names Core and React at ${tag} URLs, and nothing else.`);

  const staticServer = spawn(process.execPath, [join(root, "scripts/release-server.mjs"), mirror], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  servers.push(staticServer);

  const port = await new Promise((done, fail) => {
    staticServer.once("message", done);
    staticServer.once("error", fail);
    staticServer.once("exit", (code) => fail(new Error(`static server exited ${code}`)));
  });

  const origin = `http://127.0.0.1:${port}`;
  console.log(`Static server ${origin}, PID ${staticServer.pid}.`);
  console.log(
    "Proof-only rewrite: copy the dry tarballs, replace the github.com origin with loopback in each package.json; keep every GitHub path. Original dry assets stay untouched.",
  );

  const assets = join(mirror, `lagz0ne/tinkered/releases/download/${tag}`);
  await mkdir(assets, { recursive: true });
  for (const name of ["core", "react"]) {
    const file = `tinker-${name}-${version}.tgz`;
    const unpacked = join(scratch, name);
    await mkdir(unpacked);
    run("tar", ["-xzf", join(release, "assets", file), "-C", unpacked]);

    const pkgPath = join(unpacked, "package/package.json");
    const text = await readFile(pkgPath, "utf8");
    if (name === "react") {
      assert.equal(
        JSON.parse(text).dependencies["@tinker/core"],
        releaseUrls(version)["@tinker/core"],
      );
      console.log("PASS: packed React names Core by its GitHub release URL.");
    }

    await writeFile(pkgPath, text.replaceAll("https://github.com", origin));
    run("tar", ["-czf", join(assets, file), "-C", unpacked, "package"]);
  }

  const urls = releaseUrls(version, origin);
  console.log(`URLS ${JSON.stringify(urls)}`);

  assert.deepEqual(await readdir(consumer), []);
  run("npm", ["init", "--yes"], consumer);
  run("npm", ["install", urls["@tinker/core"], urls["@tinker/react"], "react@19"], consumer);
  console.log("PASS: npm install of the two loopback URLs in an empty folder.");

  const installed = JSON.parse(
    await readFile(join(consumer, "node_modules/@tinker/core/package.json"), "utf8"),
  );
  assert.equal(installed.version, version);
  console.log(`PASS: node_modules/@tinker/core is ${installed.version}.`);

  await writeFile(
    join(consumer, "probe.mjs"),
    [
      'import { createScope, data } from "@tinker/core";',
      'import * as react from "@tinker/react";',
      "",
      'const count = data({ label: "count", initial: 41 });',
      "const scope = createScope();",
      "const value = scope.resolve(count);",
      "if (value !== 41) throw new Error(`data gave ${value}`);",
      'if (typeof react.useData !== "function") throw new Error("no useData");',
      "await scope.close();",
      'console.log(`PROBE data 41; @tinker/react exports ${Object.keys(react).sort().join(", ")}`);',
      "",
    ].join("\n"),
  );
  const probe = run(process.execPath, ["probe.mjs"], consumer);
  assert.ok(probe.includes("PROBE data 41"));
  console.log(
    "PASS: an ESM script imports Core and React; createScope resolves a data cell; React has useData.",
  );

  console.log(
    "NOT PROVEN: public GitHub download URLs, real publication, other package managers, React rendering in a browser.",
  );
} finally {
  for (const child of servers.reverse()) await stop(child);
}

console.log("PASS: every proof server stopped by PID. Nothing published.");
