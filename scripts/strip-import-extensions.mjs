import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { parseSync } = createRequire(new URL("../tools/jev/package.json", import.meta.url))(
  "oxc-parser",
);
const ending = /\.(?:ts|tsx|mts)$/;
const moduleNodes = new Set([
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportAllDeclaration",
  "ImportExpression",
  "TSImportType",
]);

/** Keep the file's quotes; offsets from the parser refer to JavaScript string indices. */
function quoted(value, quote) {
  const escaped = JSON.stringify(value).slice(1, -1);
  return quote === '"' ? `"${escaped}"` : `'${escaped.replaceAll("'", "\\'")}'`;
}

/** Pick only syntax that names a module, rather than arbitrary path strings. */
function moduleSource(node) {
  if (moduleNodes.has(node.type)) return node.source;
  if (node.type === "TSExternalModuleReference") return node.expression;
  return null;
}

/** Rewrite an embedded code sample without changing the surrounding string's meaning. */
function sampleEdit(node, text) {
  if (node.type === "Literal" && typeof node.value === "string") {
    const inner = stripDocument(node.value);
    return { ...inner, text: quoted(inner.text, text[node.start]) };
  }
  if (node.type !== "TemplateElement") return null;
  const inner = stripDocument(node.value.cooked ?? node.value.raw);
  return {
    ...inner,
    text: inner.text.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${"),
  };
}

/** Parse module paths, including code held in fixture strings and template pieces. */
export function stripSource(text, file = "sample.tsx") {
  if (!/\.(?:ts|tsx|mts)\b/.test(text)) return { text, count: 0 };
  const edits = [];
  let count = 0;
  function visit(node) {
    const source = moduleSource(node);
    if (source?.type === "Literal" && ending.test(source.value)) {
      edits.push({
        start: source.start,
        end: source.end,
        text: quoted(source.value.replace(ending, ""), text[source.start]),
      });
      count++;
      return;
    }
    const inner = sampleEdit(node, text);
    if (inner?.count) {
      edits.push({ start: node.start, end: node.end, text: inner.text });
      count += inner.count;
      return;
    }
    Object.values(node)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter((value) => value && typeof value === "object")
      .forEach(visit);
  }
  visit(parseSync(file, text).program);
  for (const edit of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return { text, count };
}

/** Code samples may be Markdown fences, inline code, or plain source fragments. */
export function stripDocument(text) {
  if (!/\b(?:import|export)\b/.test(text)) return { text, count: 0 };
  let count = 0;
  const replace = (source) => {
    const result = stripSource(source);
    count += result.count;
    return result.text;
  };
  if (text.includes("```")) {
    text = text.replace(
      /(```[^\n]*\n)([\s\S]*?)(```)/g,
      (_, open, code, close) => open + replace(code) + close,
    );
  } else return stripSource(text);
  return { text, count };
}

/** Registry JSON holds source in content fields; paths and package exports stay intact. */
function stripJson(text) {
  let count = 0;
  const value = JSON.parse(text, (_, value) => {
    if (typeof value !== "string") return value;
    const result = stripDocument(value);
    count += result.count;
    return result.text;
  });
  return { text: count ? JSON.stringify(value, null, 2) + "\n" : text, count };
}

/** Walk tracked files and new source files; git omits dependencies and build output. */
function main() {
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  const counts = new Map();
  for (const file of new Set(files)) {
    if (!/\.(?:[cm]?[jt]sx?|md|json|txt|sh)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    const result = file.endsWith(".json")
      ? stripJson(text)
      : /\.(?:md|txt|sh)$/.test(file)
        ? stripDocument(text)
        : stripSource(text, file);
    if (!result.count) continue;
    writeFileSync(file, result.text);
    const group = /^(packages|apps)\//.test(file)
      ? file.split("/").slice(0, 2).join("/")
      : file.split("/")[0];
    counts.set(group, (counts.get(group) ?? 0) + result.count);
    console.log(`${file}: ${result.count}`);
  }
  console.log(JSON.stringify(Object.fromEntries(counts), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
