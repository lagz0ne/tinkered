import type { Plugin } from "vite-plus";

/**
 * A Vite plugin for the tests: `import page from "./x.md" with { type: "text" }` gives the
 * file's text, as Bun gives it in `bun build` and at run time. Vite has no text import.
 */
export function textImport(): Plugin {
  return {
    name: "tinker:text-import",
    enforce: "pre",
    async load(id) {
      if (!id.endsWith(".md")) return null;
      return `export default ${JSON.stringify(await Bun.file(id).text())};`;
    },
  };
}
