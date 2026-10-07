import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { registryItems } from "../apps/start-scaffold/maintain/registry-source.mjs";
import { releaseUrls } from "../packages/start/lib/release.mjs";

/** Local assets only. There is deliberately no publish mode or GitHub client. */
const [version, ...flags] = process.argv.slice(2);
assert.ok(
  flags.every((flag) => flag === "--dry"),
  "usage: node scripts/release.mjs <version> [--dry]",
);
const urls = releaseUrls(version);
const root = resolve(import.meta.dirname, "..");
const out = join(root, ".release", `start-v${version}`);
const assets = join(out, "assets");
const registryPath = "apps/start-scaffold/public/r";
const scratch = await mkdtemp(join(tmpdir(), "tinker-release-"));
const packDir = join(scratch, "packs");
await mkdir(packDir);
await mkdir(assets, { recursive: true });
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: "inherit" });
try {
  run("vp", ["run", "-r", "build"]);
  const manifest = { version, tag: `start-v${version}`, assets: [] };
  for (const name of ["core", "react", "start"]) {
    const source = join(root, "packages", name);
    const current = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    if (name === "start") run(process.execPath, [join(source, "scripts/pack.mjs"), packDir]);
    else run("vp", ["pm", "pack", "--pack-destination", packDir], source);
    const unpacked = join(scratch, name);
    await mkdir(unpacked);
    run("tar", ["-xzf", join(packDir, `tinker-${name}-${current.version}.tgz`), "-C", unpacked]);
    const pkgPath = join(unpacked, "package/package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    pkg.version = version;
    for (const field of ["dependencies", "devDependencies"]) {
      for (const dependency of Object.keys(pkg[field] ?? {}))
        if (dependency in urls) pkg[field][dependency] = urls[dependency];
    }
    if (name === "start") {
      pkg.tinker.tested["@tinker/core"] = version;
      pkg.tinker.tested["@tinker/react"] = version;
    }
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    const file = `tinker-${name}-${version}.tgz`;
    const target = join(assets, file);
    run("tar", ["-czf", target, "-C", unpacked, "package"]);
    const size = (await stat(target)).size;
    const sha256 = createHash("sha256")
      .update(await readFile(target))
      .digest("hex");
    manifest.assets.push({ file, size, sha256, url: urls[`@tinker/${name}`] });
    console.log(`ASSET ${file} ${size} bytes sha256 ${sha256}`);
  }
  const { registry, items, packages } = await registryItems({ version });
  const registryOut = join(out, registryPath);
  await mkdir(registryOut, { recursive: true });
  for (const item of items)
    await writeFile(join(registryOut, `${item.name}.json`), JSON.stringify(item, null, 2) + "\n");
  await writeFile(
    join(registryOut, "registry.json"),
    JSON.stringify({ ...registry, items }, null, 2) + "\n",
  );
  for (const [path, pkg] of Object.entries(packages))
    await writeFile(join(out, "apps/start-scaffold", path), JSON.stringify(pkg, null, 2) + "\n");
  await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`DRY RELEASE ${out}`);
  console.log(
    `REGISTRY ${registryPath}: ${items.length} items with release URLs; nothing published.`,
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
