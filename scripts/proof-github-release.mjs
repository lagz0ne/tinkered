import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join, relative, resolve } from "node:path";
import { releaseUrls } from "../packages/start/lib/release.mjs";

/** Real shadcn, HTTP tarballs, build, doctor, and upgrade. No framework runs inside tests. */
const root = resolve(import.meta.dirname, "..");
const scratch = await mkdtemp(join(tmpdir(), "tinker-github-release-proof-"));
const mirror = join(scratch, "mirror");
const consumer = join(scratch, "app");
await mkdir(mirror);
await mkdir(consumer);
const servers = [];
const env = { ...process.env, CI: "true", npm_config_audit: "false", npm_config_fund: "false" };
console.log(`Proof folder: ${scratch}`);

console.log(
  "Assumption: shared 0.7.0 is the first GitHub set; 0.7.1 is a local version-only upgrade fixture.",
);

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

async function hashes(dir, excluded = new Set()) {
  const result = {};
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const file = join(path, entry.name);
      if (entry.isDirectory()) await visit(file);
      else
        result[relative(dir, file)] = createHash("sha256")
          .update(await readFile(file))
          .digest("hex");
    }
  }
  await visit(dir);
  return result;
}

try {
  for (const version of ["0.7.0", "0.7.1"])
    run(process.execPath, [
      "scripts/release.mjs",
      version,
      ...(version === "0.7.0" ? [] : ["--dry"]),
    ]);
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
    "Proof-only rewrite: copy dry folders, replace github.com and raw.githubusercontent.com origins with loopback; keep every GitHub path. Patch the packed URL default too, then rehash files.json. Original dry assets stay untouched.",
  );
  const rewrite = (text) =>
    text
      .replaceAll("https://github.com", origin)
      .replaceAll("https://raw.githubusercontent.com", origin);
  for (const version of ["0.7.0", "0.7.1"]) {
    const release = join(root, ".release", `start-v${version}`);
    const assets = join(mirror, `lagz0ne/tinkered/releases/download/start-v${version}`);
    const registry = join(
      mirror,
      `lagz0ne/tinkered/start-v${version}/apps/start-scaffold/public/r`,
    );
    await mkdir(assets, { recursive: true });
    await cp(join(release, "apps/start-scaffold/public/r"), registry, { recursive: true });
    for (const file of await readdir(registry))
      await writeFile(join(registry, file), rewrite(await readFile(join(registry, file), "utf8")));
    for (const name of ["core", "react", "start"]) {
      const file = `tinker-${name}-${version}.tgz`;
      const unpacked = join(scratch, `${name}-${version}`);
      await mkdir(unpacked);
      run("tar", ["-xzf", join(release, "assets", file), "-C", unpacked]);
      const pkgPath = join(unpacked, "package/package.json");
      await writeFile(pkgPath, rewrite(await readFile(pkgPath, "utf8")));
      if (name === "start") {
        const pinned = JSON.parse(await readFile(join(unpacked, "package/files.json"), "utf8"));
        assert.deepEqual(
          pinned,
          await hashes(join(unpacked, "package"), new Set(["files.json", "package.json"])),
        );
        console.log(`PASS: original Start ${version} byte pins match every packed file.`);
        const urls = join(unpacked, "package/lib/release.mjs");
        await writeFile(urls, rewrite(await readFile(urls, "utf8")));
        pinned["lib/release.mjs"] = createHash("sha256")
          .update(await readFile(urls))
          .digest("hex");
        await writeFile(
          join(unpacked, "package/files.json"),
          JSON.stringify(pinned, null, 2) + "\n",
        );
      }
      run("tar", ["-czf", join(assets, file), "-C", unpacked, "package"]);
    }
    console.log(
      `REGISTRY ${origin}/lagz0ne/tinkered/start-v${version}/apps/start-scaffold/public/r/app.json`,
    );
    console.log(`URLS ${JSON.stringify(releaseUrls(version, origin))}`);
  }
  assert.deepEqual(await readdir(consumer), []);
  run(
    "npx",
    [
      "--yes",
      "shadcn@4.21.0",
      "add",
      `${origin}/lagz0ne/tinkered/start-v0.7.0/apps/start-scaffold/public/r/app.json`,
      "--yes",
    ],
    consumer,
  );
  console.log("PASS: one shadcn add in an empty folder.");
  run("npm", ["install"], consumer);
  run("vp", ["build"], consumer);
  const tinker = join(consumer, "node_modules/.bin/tinker");
  run(tinker, ["doctor"], consumer);
  const probe = createServer();
  await new Promise((done) => probe.listen(0, "127.0.0.1", done));
  const hostPort = probe.address().port;
  await new Promise((done) => probe.close(done));
  const host = spawn(tinker, ["serve"], {
    cwd: consumer,
    env: {
      ...env,
      HOST: "127.0.0.1",
      PORT: String(hostPort),
      VICTORIA_TRACES_URL: "http://127.0.0.1:1/traces",
      VICTORIA_LOGS_URL: "http://127.0.0.1:1/logs",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  servers.push(host);
  await new Promise((done, fail) => {
    host.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      if (chunk.toString().includes("tinker serve:")) done();
    });
    host.once("error", fail);
    host.once("exit", (code) => fail(new Error(`host exited ${code}`)));
  });
  const html = run("curl", ["--fail", "--silent", `http://127.0.0.1:${hostPort}/`]);
  assert.ok(html.includes("Hello, world."));
  console.log("PASS: GET / HTTP 200; Hello, world.");
  await stop(host);
  const excluded = new Set([
    "package.json",
    "package-lock.json",
    "node_modules",
    ".tinker",
    ".tanstack",
    "dist",
  ]);
  const userBefore = await hashes(consumer, excluded);
  const packageBefore = await readFile(join(consumer, "package.json"), "utf8");
  const baseFile = join(consumer, "node_modules/@tinker/start/src/index.ts");
  const original = await readFile(baseFile, "utf8");
  await writeFile(baseFile, original + "\n");
  const refusal = run(tinker, ["upgrade", "0.7.1"], consumer, 1);
  assert.ok(refusal.includes("src/index.ts changed"));
  assert.equal(await readFile(join(consumer, "package.json"), "utf8"), packageBefore);
  await writeFile(baseFile, original);
  console.log("PASS: edited base refused before package.json changed.");
  run(tinker, ["upgrade", "0.7.1"], consumer);
  const pkg = JSON.parse(await readFile(join(consumer, "package.json"), "utf8"));
  for (const [name, url] of Object.entries(releaseUrls("0.7.1", origin)))
    assert.equal(pkg.dependencies[name], url);
  assert.deepEqual(await hashes(consumer, excluded), userBefore);
  console.log("PASS: upgrade 0.7.0 -> 0.7.1 writes all three new URLs; every user file unchanged.");
  run("vp", ["build"], consumer);
  run(tinker, ["doctor"], consumer);
  console.log(
    "NOT PROVEN: public GitHub downloads/raw URLs, real publication, other package managers, live demo auth/sync/mail. 0.7.1 changes version metadata only.",
  );
} finally {
  for (const child of servers.reverse()) await stop(child);
}

console.log("PASS: every proof server stopped by PID. Nothing published.");
