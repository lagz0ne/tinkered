import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ending = /\.(?:ts|tsx|mts)$/;

/** Check copied code even when it is a fragment that cannot form a complete syntax tree. */
function textEndings(text) {
  return [...text.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s+)(["'])([^"'\r\n]+)\1/g)]
    .map((match) => match[2])
    .filter((name) => ending.test(name));
}

/** A receipt's encoded JSON needs decoding before its export lines and seam fields are read. */
function savedEndings(value, inSeams = false) {
  if (typeof value === "string") {
    try {
      return savedEndings(JSON.parse(value), inSeams);
    } catch {
      return textEndings(value);
    }
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(inSeams && key === "from" && typeof child === "string" && ending.test(child)
      ? [child]
      : []),
    ...savedEndings(child, inSeams || key === "seams"),
  ]);
}

/** Paths and file targets keep their endings; only module syntax and seam module fields fail. */
export function savedModuleEndings(file, text) {
  if (!file.endsWith(".json")) return textEndings(text);
  try {
    return savedEndings(JSON.parse(text));
  } catch {
    return textEndings(text);
  }
}

/** No arguments checks every saved doc, JSON file, and template tracked by git. */
function main() {
  const files = process.argv.slice(2);
  if (!files.length)
    files.push(
      ...execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
        encoding: "utf8",
      })
        .split("\0")
        .filter((file) => /\.(?:md|json|txt)$/.test(file)),
    );
  let count = 0;
  for (const file of new Set(files)) {
    for (const name of savedModuleEndings(file, readFileSync(file, "utf8"))) {
      count++;
      console.error(`${file}: ${name} has a TypeScript module ending; remove .ts/.tsx/.mts`);
    }
  }
  console.log(`Saved module ending check: ${count} hit(s).`);
  process.exitCode = count ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
