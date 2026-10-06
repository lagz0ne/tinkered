import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseSync } from "oxc-parser";
import { installedBase, installedVersion, listFiles, readJson, sha256 } from "./paths.mjs";
import { prepare, render } from "./prepare.mjs";

const ok = (reason) => ({ status: "ok", reason });
const skip = (reason) => ({ status: "skip", reason });
const fail = (reason, fix) => ({ status: "fail", reason, fix });

/** @param {string} root - From the CLI; why: every check reads the app there. */
function baseVersion(root) {
  const dir = installedBase(root);
  if (!dir) return fail("@tinker/start does not resolve; add it to package.json and install");
  const pkg = readJson(join(dir, "package.json"));
  const tested = Object.entries(pkg.tinker.tested);
  const drift = tested
    .map(([name, version]) => [name, version, installedVersion(root, name)])
    .filter(([, version, found]) => found !== version)
    .map(([name, version, found]) => `${name} is ${found ?? "missing"}, tested with ${version}`);
  if (drift.length > 0) return fail(drift.join("; "));
  return ok(`@tinker/start ${pkg.version}; ${tested.length} peers match the tested versions`);
}

/**
 * @param {string} dir - From the installed base; why: hash what is on disk.
 * @param {Record<string, string>} pinned - From files.json; why: the released bytes.
 */
function changedFiles(dir, pinned) {
  const own = new Set(["files.json", "package.json"]);
  const changed = Object.entries(pinned)
    .filter(([file, hash]) => !existsSync(join(dir, file)) || sha256(join(dir, file)) !== hash)
    .map(([file]) => ({ file, kind: existsSync(join(dir, file)) ? "changed" : "missing" }));
  const added = listFiles(dir)
    .filter((file) => !own.has(file) && !(file in pinned))
    .map((file) => ({ file, kind: "added" }));
  return [...changed, ...added];
}

/**
 * Put the released bytes back from the tarball the app depends on.
 * @param {string} root - From the CLI; why: read the app's dependency spec.
 * @param {string} dir - From the installed base; why: the folder to repair.
 * @param {{ file: string, kind: string }[]} changed - From changedFiles; why: what to repair.
 */
function restoreBase(root, dir, changed) {
  const spec = readJson(join(root, "package.json")).dependencies["@tinker/start"];
  if (!/^file:.*\.tgz$/.test(spec))
    return `reinstall @tinker/start (${spec}) with your package manager`;
  const unpacked = mkdtempSync(join(tmpdir(), "tinker-restore-"));
  execFileSync("tar", ["-xzf", resolve(root, spec.slice(5)), "-C", unpacked]);
  for (const { file, kind } of changed) {
    if (kind === "added") rmSync(join(dir, file));
    else writeFileSync(join(dir, file), readFileSync(join(unpacked, "package", file)));
  }
  rmSync(unpacked, { recursive: true, force: true });
  return `restored ${changed.length} file(s) from ${spec.slice(5).split("/").at(-1)}`;
}

/** @param {string} root - From the CLI; why: every check reads the app there. */
export function baseBytes(root) {
  const dir = installedBase(root);
  if (!dir) return fail("@tinker/start does not resolve");
  if (!dir.split(sep).includes("node_modules"))
    return skip(`workspace link to ${relative(root, dir)}; a source checkout has no pinned bytes`);
  if (!existsSync(join(dir, "files.json"))) return fail("files.json is missing from the base");
  const pinned = readJson(join(dir, "files.json"));
  const changed = changedFiles(dir, pinned);
  if (changed.length === 0) return ok(`${Object.keys(pinned).length} files match files.json`);
  const list = changed.map(({ file, kind }) => `${file} ${kind}`).join(", ");
  return fail(
    `${list} in node_modules/@tinker/start. An install drops base edits; use an extension point`,
    () => restoreBase(root, dir, changed),
  );
}

/** @param {string} root - From the CLI; why: read the app's .gitignore. */
function ignoresTinker(root) {
  const path = join(root, ".gitignore");
  return existsSync(path) && readFileSync(path, "utf8").split("\n").includes(".tinker/");
}

/** @param {string} root - From the CLI; why: every check reads the app there. */
function generated(root) {
  const dir = join(root, ".tinker");
  const stale = Object.entries(render(root))
    .filter(
      ([name, text]) =>
        !existsSync(join(dir, name)) || readFileSync(join(dir, name), "utf8") !== text,
    )
    .map(([name]) => name);
  const ignored = ignoresTinker(root);
  if (stale.length === 0 && ignored) return ok(".tinker/ matches this base; .gitignore lists it");
  const problems = [
    existsSync(dir) ? stale.length > 0 && `stale: ${stale.join(", ")}` : ".tinker/ is missing",
    !ignored && ".gitignore does not list .tinker/",
  ].filter(Boolean);
  return fail(problems.join("; "), () => {
    prepare(root);
    if (!ignored) appendFileSync(join(root, ".gitignore"), ".tinker/\n");
    return `ran tinker prepare${ignored ? "" : "; added .tinker/ to .gitignore"}`;
  });
}

/** @param {string} root - From the CLI; why: the tsconfig line --fix may write. */
function fixTsconfig(root) {
  const path = join(root, "tsconfig.json");
  const config = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  writeFileSync(
    path,
    JSON.stringify({ ...config, extends: "./.tinker/tsconfig.json" }, null, 2) + "\n",
  );
  return "set extends in tsconfig.json";
}

/** @param {string} root - From the CLI; why: read vite.config.ts as text. */
function viteProblems(root) {
  const path = join(root, "vite.config.ts");
  if (!existsSync(path)) return ["vite.config.ts is missing"];
  const text = readFileSync(path, "utf8");
  const calls = text.match(/\btinker\(/g)?.length ?? 0;
  return [
    !text.includes('"@tinker/start/vite"') && 'vite.config.ts does not import "@tinker/start/vite"',
    calls !== 1 && `vite.config.ts calls tinker() ${calls} times; add plugins: [tinker()]`,
    /\btanstackStart\(/.test(text) &&
      "vite.config.ts adds a second tanstackStart(); tinker() owns it",
  ].filter(Boolean);
}

/** @param {string} root - From the CLI; why: read tsconfig.json. */
function extendsTinker(root) {
  try {
    return readJson(join(root, "tsconfig.json")).extends === "./.tinker/tsconfig.json";
  } catch {
    return false;
  }
}

/** @param {string} root - From the CLI; why: every check reads the app there. */
function glue(root) {
  const base = installedBase(root);
  const problems = [
    ...viteProblems(root),
    !extendsTinker(root) && 'tsconfig.json does not extend "./.tinker/tsconfig.json"',
    !base && "@tinker/start/server does not resolve",
  ].filter(Boolean);
  if (problems.length === 0)
    return ok("vite.config.ts calls tinker() once; tsconfig.json extends .tinker");
  if (extendsTinker(root)) return fail(problems.join("; "));
  return fail(problems.join("; "), () => fixTsconfig(root));
}

/** @param {object} node - From oxc-parser; why: walk every child node. */
function children(node) {
  return Object.values(node)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => value && typeof value === "object");
}

/**
 * Every module path one source file names, with its line.
 * @param {string} path - From the src walk; why: parse that file.
 */
function specifiers(path) {
  const source = readFileSync(path, "utf8");
  const found = [];
  const visit = (node) => {
    const name = node.source?.value;
    if (typeof name === "string" && node.type !== "Literal") {
      found.push({ name, line: source.slice(0, node.start).split("\n").length });
    }
    children(node).forEach(visit);
  };
  visit(parseSync(path, source).program);
  return found;
}

const entries = new Set(["@tinker/start", "@tinker/start/server", "@tinker/start/vite"]);

/**
 * @param {string} name - From an import; why: judge that one path.
 * @param {string} file - From the src walk; why: resolve a relative path from it.
 * @param {string | null} base - From installedBase; why: a relative path must not reach it.
 */
function badImport(name, file, base) {
  if (name.startsWith("#tinker/")) return "is the base's own seam name";
  if (name.startsWith("@tinker/start") && !entries.has(name))
    return "is not a base entry; use @tinker/start or @tinker/start/server";
  const target = name.startsWith(".") ? resolve(dirname(file), name) : "";
  if (target.includes(`${sep}node_modules${sep}@tinker${sep}start${sep}`))
    return "reaches into the base by path";
  if (base && target.startsWith(base + sep)) return "reaches into the base by path";
  return null;
}

/** @param {string} root - From the CLI; why: every check reads the app there. */
function imports(root) {
  const base = installedBase(root);
  const files = listFiles(join(root, "src")).filter((file) => /\.tsx?$/.test(file));
  const bad = files.flatMap((file) => {
    const path = join(root, "src", file);
    return specifiers(path)
      .map(({ name, line }) => ({ name, line, why: badImport(name, path, base) }))
      .filter(({ why }) => why)
      .map(({ name, line, why }) => `src/${file}:${line} "${name}" ${why}`);
  });
  if (bad.length > 0) return fail(bad.join("; "));
  return ok(`${files.length} files in src/ import the base only through its entries`);
}

/** @param {string} path - From the seam check; why: list the names that file exports. */
function exportedNames(path) {
  const { program } = parseSync(path, readFileSync(path, "utf8"));
  return program.body
    .filter((node) => node.type === "ExportNamedDeclaration")
    .flatMap((node) => [
      ...(node.declaration?.declarations ?? []).map((item) => item.id.name),
      ...node.specifiers.map((item) => item.exported.name),
    ]);
}

/** @param {string} root - From the CLI; why: every check reads the app there. */
function seams(root) {
  const present = ["tinker.ts", "tinker.server.ts"].filter((file) =>
    existsSync(join(root, "src/lib", file)),
  );
  if (present.length === 0) return ok("no seam files; the base defaults are in use");
  const missing = present.filter(
    (file) => !exportedNames(join(root, "src/lib", file)).includes("extensions"),
  );
  if (missing.length > 0)
    return fail(`src/lib/${missing.join(", src/lib/")} must export extensions`);
  return ok(`${present.join(", ")} export what the base reads`);
}

/** @param {string} root - From the CLI; why: every check reads the app there. */
function routes(root) {
  const base = installedBase(root);
  const owned = new Set(base ? readJson(join(base, "package.json")).tinker.routes : []);
  const dir = join(root, "src/routes");
  const taken = listFiles(dir).flatMap((file) =>
    [...readFileSync(join(dir, file), "utf8").matchAll(/createFileRoute\(\s*["'`]([^"'`]+)/g)]
      .map((match) => match[1])
      .filter((path) => owned.has(path))
      .map((path) => `src/routes/${file} takes ${path}, a base route`),
  );
  if (taken.length > 0) return fail(taken.join("; "));
  return ok(`no app route takes a base path (${[...owned].join(", ")})`);
}

const checks = [
  { label: "base version", check: baseVersion },
  { label: "base bytes", check: baseBytes },
  { label: "generated folder", check: generated },
  { label: "glue", check: glue },
  { label: "seams", check: seams },
  { label: "imports", check: imports },
  { label: "routes", check: routes },
];

/** @param {string} text - From a check; why: keep each printed line short for a phone. */
function wrap(text) {
  const lines = [""];
  for (const word of text.split(" ")) {
    const last = lines.length - 1;
    if (lines[last] && lines[last].length + word.length > 50) lines.push(word);
    else lines[last] = lines[last] ? `${lines[last]} ${word}` : word;
  }
  return lines.map((line) => `      ${line}`).join("\n");
}

/**
 * @param {string} root - From the CLI; why: the app to check.
 * @param {boolean} fix - From --fix; why: repair base-owned and generated files only.
 */
export function doctor(root, fix) {
  let failed = 0;
  checks.forEach(({ label, check }, index) => {
    let result = check(root);
    if (fix && result.fix) {
      const note = result.fix();
      const again = check(root);
      result = again.status === "ok" ? { status: "fixed", reason: note } : again;
    }
    if (result.status === "fail") failed += 1;
    console.log(`${result.status.padEnd(5)} ${index + 1} ${label}\n${wrap(result.reason)}`);
  });
  console.log(failed === 0 ? "doctor: all checks pass" : `doctor: ${failed} check(s) fail`);
  return failed === 0 ? 0 : 1;
}
