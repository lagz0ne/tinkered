import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { releasePackages, releaseUrls } from "./release-urls.mjs";

/** Local assets only. There is deliberately no publish mode or GitHub client. */
const [version, ...flags] = process.argv.slice(2);

assert.ok(
  flags.every((flag) => flag === "--dry"),
  "usage: node scripts/release.mjs <version> [--dry]",
);

const urls = releaseUrls(version);
const root = resolve(import.meta.dirname, "..");
const tag = `v${version}`;
const out = join(root, ".release", tag);
const assets = join(out, "assets");
const scratch = await mkdtemp(join(tmpdir(), "tinker-release-"));
const packDir = join(scratch, "packs");
await mkdir(packDir);
await mkdir(assets, { recursive: true });
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: "inherit" });

try {
  run("vp", ["run", "-r", "build"]);
  const manifest = { version, tag, assets: [] };

  for (const name of releasePackages) {
    const source = join(root, "packages", name);
    const current = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    run("vp", ["pm", "pack", "--pack-destination", packDir], source);

    const unpacked = join(scratch, name);
    await mkdir(unpacked);
    run("tar", ["-xzf", join(packDir, `tinkered-${name}-${current.version}.tgz`), "-C", unpacked]);

    const pkgPath = join(unpacked, "package/package.json");
    const packed = JSON.parse(await readFile(pkgPath, "utf8"));

    // Two tarballs per package. The GitHub one names its siblings by release URL. The npm one
    // names them by `^version`, so an app gets one Core after an upgrade (ADR 0146).
    const kinds = [
      {
        file: `tinker-${name}-${version}.tgz`,
        pin: (dep) => urls[dep],
        url: urls[`@tinkered/${name}`],
      },
      { file: `npm-tinkered-${name}-${version}.tgz`, pin: () => `^${version}`, url: null },
    ];

    for (const kind of kinds) {
      const pkg = structuredClone(packed);
      pkg.version = version;

      // The packed React names Core by version in dependencies and devDependencies.
      for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
        for (const dependency of Object.keys(pkg[field] ?? {})) {
          if (dependency in urls) pkg[field][dependency] = kind.pin(dependency);
        }
      }

      await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
      const file = kind.file;
      const target = join(assets, file);
      run("tar", ["-czf", target, "-C", unpacked, "package"]);

      const size = (await stat(target)).size;
      const sha256 = createHash("sha256")
        .update(await readFile(target))
        .digest("hex");
      manifest.assets.push({ file, size, sha256, url: kind.url });
      console.log(`ASSET ${file} ${size} bytes sha256 ${sha256}`);
    }
  }

  await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`DRY RELEASE ${out}: GitHub and npm tarballs; nothing published.`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
