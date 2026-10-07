import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  if (node.type === "TSModuleDeclaration") return node.id;
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
  if (!/\b(?:import|export|require|module)\b/.test(text)) return { text, count: 0 };
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
  }
  text = text.replace(/(?<!`)`([^`\n]+)`(?!`)/g, (_, code) => `\`${replace(code)}\``);
  const source = stripSource(text);
  text = source.text;
  count += source.count;
  text = text.replace(
    /\b(?:import|export)\b[^\n;]*?\bfrom\s*["'][^"']+["']|\bimport\s*(?:\(\s*["'][^"']+["']\s*\)|["'][^"']+["'])/g,
    replace,
  );
  return { text, count };
}

/** Shell arguments and here-doc lines hold TypeScript samples, rather than shell imports. */
function stripShell(text) {
  let count = 0;
  const rewrite = (code) => {
    const result = stripSource(code);
    count += result.count;
    return result.text;
  };
  text = text.replace(/'([^'\n]*)'/g, (_, code) => `'${rewrite(code)}'`);
  text = text.replace(/^(?:import|export)\b[^\n]*/gm, rewrite);
  return { text, count };
}

/** Registry JSON holds source in content fields; paths and package exports stay intact. */
function stripJson(text) {
  const result = stripSource(`(${text})`);
  return { ...result, text: result.text.slice(1, -1) };
}

/** Saved judge inputs are code samples too; their IDs must still match their edited state. */
export function stripJsonLines(text) {
  let count = 0;
  text = text
    .split("\n")
    .map((line) => {
      if (!line.trim()) return line;
      const result = stripJson(line);
      if (!result.count) return line;
      count += result.count;
      const row = JSON.parse(result.text);
      if (typeof row.id === "string" && typeof row.label === "boolean" && row.judge && row.state)
        row.id = createHash("sha256")
          .update(row.judge + String(row.label) + JSON.stringify(row.state))
          .digest("hex")
          .slice(0, 12);
      return JSON.stringify(row);
    })
    .join("\n");
  return { text, count };
}

/** Decode a highlighted sample while keeping each character's place in the HTML. */
function htmlText(html) {
  const entities = {
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
  };
  const offsets = [];
  let text = "";
  for (const part of html.matchAll(/<[^>]*>|&(?:quot|apos|lt|gt|amp|#39);|[^<&]+|[<&]/g)) {
    if (part[0].startsWith("<") && part[0].length > 1) continue;
    const value = entities[part[0]] ?? part[0];
    for (let i = 0; i < value.length; i++)
      offsets.push({
        start: part.index + i,
        end: part.index + (entities[part[0]] ? part[0].length : i + 1),
      });
    text += value;
  }
  return { text, offsets };
}

/** Remove parsed module endings from code samples without losing their color spans. */
function stripHighlighted(html) {
  const { text, offsets } = htmlText(html);
  const edits = [];
  let count = 0;
  function visit(node) {
    const source = moduleSource(node);
    const suffix = source?.type === "Literal" ? source.value?.match?.(ending)?.[0] : null;
    if (suffix) {
      edits.push(...offsets.slice(source.end - 1 - suffix.length, source.end - 1));
      count++;
    }
    Object.values(node)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter((value) => value && typeof value === "object")
      .forEach(visit);
  }
  visit(parseSync("sample.tsx", text).program);
  for (const { start, end } of edits.sort((a, b) => b.start - a.start))
    html = html.slice(0, start) + html.slice(end);
  return { text: html, count };
}

/** HTML entry paths stay; only module paths in inline code and highlighted samples change. */
export function stripHtml(text) {
  let count = 0;
  text = text.replace(
    /(<(script|code)\b[^>]*>)([\s\S]*?)(<\/\2>)/g,
    (_, open, tag, code, close) => {
      const result = tag === "code" ? stripHighlighted(code) : stripSource(code, "sample.mjs");
      count += result.count;
      return open + result.text + close;
    },
  );
  return { text, count };
}

/** Select the source reader while preserving each file's existing layout. */
function stripFile(file, text) {
  if (file.endsWith(".json")) return stripJson(text);
  if (file.endsWith(".jsonl")) return stripJsonLines(text);
  if (file.endsWith(".sh")) return stripShell(text);
  if (file.endsWith(".html")) return stripHtml(text);
  if (/\.(?:md|txt)$/.test(file)) return stripDocument(text);
  return stripSource(text, file);
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
    if (!/\.(?:[cm]?[jt]sx?|md|jsonl?|txt|sh|html)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    const result = stripFile(file, text);
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
