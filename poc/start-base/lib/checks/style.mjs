import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { shellFile } from "../named.mjs";
import { installedVersion, lineAt, listFiles, readJson, readText } from "../paths.mjs";
import { parseSource, specifiers } from "../source.mjs";
import { verdict } from "./result.mjs";

export const say = {
  shell: `${shellFile}:1 replaces the base shell and does not link src/style.css; import style from "../style.css?url" and add { rel: "stylesheet", href: style } to head links`,
  unlinked: (file) =>
    `${file}:1 is never linked: nothing imports it, and the shell links only src/style.css`,
  needs: (line, name) =>
    `src/style.css:${line} imports tailwindcss, but ${name} is not installed; tinker() adds Tailwind when it is`,
  aliasOut: (line, name, alias, target) =>
    `components.json:${line} aliases.${name} "${alias}" lands at ${target}, outside src/; shadcn writes there`,
  aliasNone: (line, name, alias) =>
    `components.json:${line} aliases.${name} "${alias}" matches no tsconfig path`,
  css: (line, css) =>
    `components.json:${line} tailwind.css is "${css}"; the base links src/style.css`,
  noStyle: 'src/style.css is missing; components.json needs it, with @import "tailwindcss"',
  noTailwind: 'src/style.css:1 does not @import "tailwindcss"; shadcn needs Tailwind',
  passed: "src/style.css is linked by the shell; every stylesheet is linked",
};

/** @param {string} root - From the style check; why: the paths shadcn reads, as tsconfig-paths merges them. */
function mergedPaths(root) {
  try {
    const own = readJson(join(root, "tsconfig.json"));
    const parent = own.extends ? readJson(resolve(root, own.extends)) : {};
    return own.compilerOptions?.paths ?? parent.compilerOptions?.paths ?? {};
  } catch {
    return {};
  }
}

/**
 * Where shadcn writes for one alias: like tsconfig-paths, it resolves the merged paths from
 * the app folder, even when they come from an extended file.
 * @param {string} root - From aliasProblems; why: shadcn resolves from there.
 * @param {Record<string, string[]>} paths - From mergedPaths; why: the table shadcn reads.
 * @param {string} alias - From components.json; why: the import path to place.
 */
function aliasTarget(root, paths, alias) {
  for (const [key, [target]] of Object.entries(paths)) {
    const prefix = key.replace(/\*$/, "");
    if (key.endsWith("*") ? alias.startsWith(prefix) : alias === key)
      return resolve(root, target.replace("*", alias.slice(prefix.length)));
  }
  return null;
}

/** @param {string} root - From the style check; why: shadcn's settings and their lines. */
function componentsProblems(root) {
  const text = readText(join(root, "components.json"));
  if (!text) return [];
  const { aliases = {}, tailwind = {} } = JSON.parse(text);
  const paths = mergedPaths(root);
  const src = join(root, "src");
  const lineOf = (key) => lineAt(text, text.indexOf(`"${key}"`));
  const aliasLines = Object.entries(aliases).map(([name, alias]) => {
    const target = aliasTarget(root, paths, alias);
    if (!target) return say.aliasNone(lineOf(name), name, alias);
    const inside = target === src || target.startsWith(src + sep);
    return inside ? null : say.aliasOut(lineOf(name), name, alias, relative(root, target));
  });
  const style = readText(join(root, "src/style.css"));
  return [
    ...aliasLines,
    tailwind.css !== "src/style.css" && say.css(lineOf("css"), tailwind.css),
    !style && say.noStyle,
    style && !/@import\s+["']tailwindcss["']/.test(style) && say.noTailwind,
  ];
}

/** @param {string} root - From the style check; why: Tailwind needs both packages in the app. */
function tailwindProblems(root) {
  const style = readText(join(root, "src/style.css"));
  const at = style.search(/@import\s+["']tailwindcss["']/);
  if (at < 0) return [];
  return ["tailwindcss", "@tailwindcss/vite"]
    .filter((name) => !installedVersion(root, name))
    .map((name) => say.needs(lineAt(style, at), name));
}

/** @param {string} path - From linkedSheets; why: the module paths one stylesheet or source file names. */
function linksOf(path) {
  if (path.endsWith(".css"))
    return [...readText(path).matchAll(/@import\s+["']([^"']+)["']/g)].map((match) => match[1]);
  if (/\.[jt]sx?$/.test(path)) return specifiers(parseSource(path)).map(({ name }) => name);
  return [];
}

/**
 * Every stylesheet some file in src/ links, by absolute path; `?url` and `@/` are read too.
 * @param {string} root - From unlinkedProblems; why: walk its src/.
 * @param {string[]} files - From unlinkedProblems; why: every file under src/.
 */
function linkedSheets(root, files) {
  const src = join(root, "src");
  return new Set(
    files.flatMap((file) =>
      linksOf(join(src, file))
        .map((name) => name.replace(/\?.*$/, ""))
        .map((name) =>
          name.startsWith("@/")
            ? join(src, name.slice(2))
            : resolve(dirname(join(src, file)), name),
        ),
    ),
  );
}

/** @param {string} root - From the style check; why: a stylesheet nobody links styles nothing. */
function unlinkedProblems(root) {
  const files = listFiles(join(root, "src"));
  const linked = linkedSheets(root, files);
  return files
    .filter((file) => file.endsWith(".css") && file !== "style.css")
    .filter((file) => !linked.has(join(root, "src", file)))
    .map((file) => say.unlinked(`src/${file}`));
}

/**
 * Check 8: the page gets its styles. A user shell links src/style.css, no stylesheet sits
 * unlinked, Tailwind's packages are there when the stylesheet imports it, and shadcn's
 * aliases land inside src/. No fix: these are app files.
 */
export function style(root) {
  const shell = readText(join(root, shellFile));
  const styled = existsSync(join(root, "src/style.css"));
  const problems = [
    shell && styled && !/style\.css\?url/.test(shell) && say.shell,
    ...unlinkedProblems(root),
    ...tailwindProblems(root),
    ...componentsProblems(root),
  ];
  return verdict(problems.filter(Boolean), say.passed);
}
