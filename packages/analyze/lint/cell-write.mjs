import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * Warn on `cell.controller`, `cell.atScope.controller` or `cell.atNamespace.controller` when
 * `cell` is a `data(...)` cell that another capsule's folder declares (ADR 0123, ADR 0126). The way in from outside is the capsule's export (`talk.point`, read only)
 * or an op it exports. A raw import still works; this rule only points at it.
 *
 * Options: `roots` are the folders whose first level is one capsule each (default
 * `["tinker/components", "src/frontend"]`, the app layout); `aliases` maps an import prefix to a
 * folder (default `{ "@/": "src/", "~/": "tinker/" }`). A file directly under a root belongs to
 * no capsule.
 *
 * It sees `export const x = data(...)` (typed or not) and `export { x } from "..."`, followed
 * through relative and aliased paths. It does not see `const x = data(...); export { x }` or a
 * namespace import (`t.x.controller`).
 */
const cellWrite = {
  meta: {
    type: "suggestion",
    messages: {
      foreign:
        "`{{name}}` is a cell of capsule `{{owner}}`. Read it through the capsule's export, " +
        "or change it with an op that capsule exports. Read: @tinker/core#core/data.",
    },
  },
  create(context) {
    const options = context.options?.[0] ?? {};
    const roots = options.roots ?? ["tinker/components", "src/frontend"];
    const aliases = options.aliases ?? { "@/": "src/", "~/": "tinker/" };
    const cwd = context.cwd ?? process.cwd();
    const file = context.filename ?? context.physicalFilename;
    const here = capsuleOf(cwd, roots, file);
    const imported = new Map();

    return {
      ImportDeclaration(node) {
        const target = resolveImport(cwd, aliases, file, node.source.value);
        if (target === undefined) return;

        const owner = capsuleOf(cwd, roots, target);
        if (owner === undefined || owner === here) return;

        for (const spec of node.specifiers) {
          if (spec.type !== "ImportSpecifier") continue;
          const name = spec.imported.name ?? spec.imported.value;
          if (cellsOf(cwd, aliases, target).has(name)) imported.set(spec.local.name, owner);
        }
      },
      MemberExpression(node) {
        if (node.computed || node.property.name !== "controller") return;
        const cell = cellOf(node.object);
        if (cell === undefined) return;

        const owner = imported.get(cell.name);
        if (owner === undefined) return;

        context.report({ node, messageId: "foreign", data: { name: cell.name, owner } });
      },
    };
  },
};

/** The cell before `.controller`: `x`, or `x` in a placed edge (`x.atScope`, `x.atNamespace`, ADR 0126). */
function cellOf(object) {
  if (object.type === "Identifier") return object;
  if (object.type !== "MemberExpression" || object.computed) return undefined;
  if (!["atScope", "atNamespace"].includes(object.property.name)) return undefined;
  return object.object.type === "Identifier" ? object.object : undefined;
}

/** The capsule folder a file sits in: the first folder under one of the roots. */
function capsuleOf(cwd, roots, file) {
  const path = relative(cwd, file).split(sep).join("/");
  for (const root of roots) {
    if (!path.startsWith(`${root}/`)) continue;

    const rest = path.slice(root.length + 1).split("/");
    return rest.length > 1 ? `${root}/${rest[0]}` : undefined;
  }

  return undefined;
}

/** The source file an import names, for a relative or aliased path; undefined for a package. */
function resolveImport(cwd, aliases, file, spec) {
  let base;
  if (spec.startsWith(".")) base = resolve(dirname(file), spec);
  else {
    const prefix = Object.keys(aliases).find((key) => spec.startsWith(key));
    if (prefix === undefined) return undefined;

    base = resolve(cwd, aliases[prefix], spec.slice(prefix.length));
  }

  const stem = base.replace(/\.(m?[jt]sx?)$/, "");
  const tries = [".ts", ".tsx", ".mts", ".js", ".mjs"].flatMap((ext) => [
    `${stem}${ext}`,
    join(stem, `index${ext}`),
  ]);
  return tries.find((path) => existsSync(path));
}

/** Per file, by its change time: the names it exports as `data(...)` cells, own or re-exported. */
const cellsByFile = new Map();

function cellsOf(cwd, aliases, file) {
  const changed = statSync(file).mtimeMs;
  const kept = cellsByFile.get(file);
  if (kept !== undefined && kept.changed === changed) return kept.cells;

  const cells = new Set();
  cellsByFile.set(file, { changed, cells });
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/export const (\w+)\s*(?::[^=]+)?=\s*data\s*[<(]/g)) {
    cells.add(m[1]);
  }

  for (const m of text.matchAll(/export\s*(\*|\{([^}]*)\})\s*from\s*["']([^"']+)["']/g)) {
    const from = resolveImport(cwd, aliases, file, m[3]);
    if (from !== undefined) addReexport(cells, cellsOf(cwd, aliases, from), m[2]);
  }

  return cells;
}

/** Add the cells one `export ... from` passes on: all of them for `*`, else the named ones. */
function addReexport(cells, inner, names) {
  if (names === undefined) {
    for (const cell of inner) cells.add(cell);
    return;
  }

  for (const part of names.split(",")) {
    const [orig, alias = orig] = part.trim().split(/\s+as\s+/);
    if (inner.has(orig)) cells.add(alias);
  }
}

export default cellWrite;
