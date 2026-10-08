import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examples = join(root, "examples");

const libraries = new Map(
  readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const folder = join(root, "packages", entry.name);
      return [readPackage(folder).name, folder];
    }),
);

function readPackage(folder) {
  return JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
}

function libraryDependencies(manifest) {
  return Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  }).filter((name) => libraries.has(name));
}

export function exampleNames() {
  return readdirSync(examples, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => entry.name)
    .sort();
}

function collectLibraries(manifest) {
  const names = new Set();
  const pending = libraryDependencies({
    dependencies: { ...manifest.dependencies, ...manifest.devDependencies },
  });
  for (const dependency of pending) {
    if (names.has(dependency)) continue;
    names.add(dependency);
    const folder = libraries.get(dependency);
    if (!existsSync(join(folder, "dist"))) {
      throw new Error(`Build the libraries first: vp run -r build (${dependency})`);
    }
    pending.push(...libraryDependencies(readPackage(folder)));
  }
  return names;
}

function copyExample(name, target) {
  const prefix = `examples/${name}/`;
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", `examples/${name}`],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  mkdirSync(target);
  for (const file of files) {
    const destination = join(target, file.slice(prefix.length));
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(root, file), destination);
  }
}

/** Copies one consumer and its built library archives; the copy owns every file it needs. */
export function exportExample(name, destination) {
  if (!exampleNames().includes(name)) {
    throw new Error(`Choose an example: ${exampleNames().join(", ")}`);
  }
  const source = join(examples, name);
  const manifest = readPackage(source);
  const target = resolve(destination);
  if (!relative(root, target).startsWith(`..${sep}`)) {
    throw new Error("Choose a new folder outside this repo.");
  }
  if (existsSync(target)) throw new Error(`The destination already exists: ${target}`);
  const names = collectLibraries(manifest);

  copyExample(name, target);
  const vendor = join(target, "vendor");
  mkdirSync(vendor);
  const overrides = { "vite@*": manifest.devDependencies.vite };
  for (const dependency of names) {
    const filename = `${dependency.replace("@", "").replace("/", "-")}.tgz`;
    execFileSync("vp", ["pm", "pack", "--out", join(vendor, filename)], {
      cwd: libraries.get(dependency),
      stdio: ["ignore", "pipe", "pipe"],
    });
    overrides[dependency] = `file:./vendor/${filename}`;
    for (const field of ["dependencies", "devDependencies"]) {
      if (manifest[field]?.[dependency] !== undefined) {
        manifest[field][dependency] = overrides[dependency];
      }
    }
  }
  writeFileSync(join(target, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(target, "pnpm-workspace.yaml"),
    [
      "packages:",
      "  - .",
      "overrides:",
      ...Object.entries(overrides).map(
        ([key, value]) => `  ${key.startsWith("@") ? JSON.stringify(key) : key}: ${value}`,
      ),
      "allowBuilds:",
      "  esbuild: true",
      "",
    ].join("\n"),
  );
  return target;
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  if (args.length !== 2) {
    console.error("Usage: vp run example:export -- core /tmp/tinker-core");
    process.exitCode = 1;
  } else {
    const folder = exportExample(args[0], args[1]);
    const command = readPackage(folder).scripts.start === undefined ? "dev" : "start";
    console.log(`Exported ${args[0]} to ${folder}`);
    console.log(`cd ${folder}\nvp install\nvp run check\nvp run test\nvp run ${command}`);
  }
}
