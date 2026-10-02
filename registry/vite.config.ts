import { fileURLToPath } from "node:url";
import { isAbsolute, relative } from "node:path";
import { defineConfig } from "vite-plus";
import catalog from "./catalog.json" with { type: "json" };

const source = fileURLToPath(new URL("./src/", import.meta.url));

export default defineConfig({
  pack: catalog.map((item) => ({
    entry: item.entries.map((entry) => `src/${item.name}/${entry}`),
    outDir: `dist/${item.name}`,
    minify: true,
    exports: false,
    deps: {
      resolveDepSubpath: true,
      neverBundle(id) {
        if (!id.startsWith(".") && !isAbsolute(id)) return true;
        return (
          id.startsWith("../") ||
          (id.startsWith(source) && !id.startsWith(`${source}${item.name}/`))
        );
      },
    },
    outputOptions: {
      paths(id) {
        const path = id.startsWith(source) ? relative(`${source}${item.name}`, id) : id;
        return path.replace(/\.ts$/, ".mjs");
      },
    },
  })),
  lint: { options: { typeAware: true, typeCheck: true } },
  fmt: {},
  test: {
    maxWorkers: 2,
    server: { deps: { inline: ["vite-plus"] } },
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**"],
    projects: catalog.map((item) => ({
      extends: true,
      test: {
        name: item.name,
        include: [["tests", item.name, "**", "*.test.ts"].join("/")],
        testTimeout: item.testTimeout,
        hookTimeout: item.hookTimeout,
        fileParallelism: item.fileParallelism,
      },
    })),
  },
});
