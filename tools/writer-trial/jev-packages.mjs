import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

/** Copy the installed package graph, with links only inside the frozen Jev folder. */
export function freezeJevPackages(source, target) {
  const copied = new Map();
  const modules = join(target, "node_modules");
  const linkPackage = (sourcePath, link) => {
    const sourceDir = realpathSync(sourcePath);
    let dest = copied.get(sourceDir);
    if (!dest) {
      dest = join(modules, ".packages", String(copied.size));
      copied.set(sourceDir, dest);
      cpSync(sourceDir, dest, {
        recursive: true,
        dereference: true,
        filter: (path) => path !== join(sourceDir, "node_modules"),
      });
      copyDependencies(sourceDir, dest, linkPackage);
    }
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(relative(dirname(link), dest), link);
  };
  try {
    const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
    for (const name of Object.keys(pkg.dependencies ?? {}))
      linkPackage(join(source, "node_modules", name), join(modules, name));
  } catch (error) {
    throw new Error(`Jev unavailable: cannot freeze packages (${error.message})`);
  }
}

function copyDependencies(source, target, linkPackage) {
  const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  const required = pkg.dependencies ?? {};
  const optional = pkg.optionalDependencies ?? {};
  const peers = pkg.peerDependencies ?? {};
  const require = createRequire(join(source, "package.json"));
  for (const name of Object.keys({ ...required, ...optional, ...peers })) {
    const path = require.resolve
      .paths(name)
      .map((base) => join(base, name))
      .find(existsSync);
    if (path) linkPackage(path, join(target, "node_modules", name));
    else if (name in required && !(name in optional))
      throw new Error(`Missing package ${name} required by ${pkg.name}`);
  }
}

/** A fresh process loads every Jev module the broker imports, without cached imports. */
export function verifyJevLoads(jevDir) {
  try {
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "for (const path of process.argv.slice(1)) await import(path)",
        ...["lib.mjs", "bank.mjs", "extract.mjs", "shape.mjs"].map(
          (file) => pathToFileURL(join(jevDir, file)).href,
        ),
      ],
      { encoding: "utf8", timeout: 30000, stdio: "pipe" },
    );
  } catch (error) {
    throw new Error(
      `Jev unavailable: frozen modules cannot load (${error.stderr ?? error.message})`,
    );
  }
}
