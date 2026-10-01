import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/migrations.ts", "src/pglite.ts"],
    deps: {
      resolveDepSubpath: true,
      neverBundle: ["@tinker/core", "drizzle-orm", "@electric-sql/pglite"],
    },
    dts: {
      generator: "tsgo",
    },
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
  test: {
    alias: {
      "@tinker/drizzle/pglite": fileURLToPath(new URL("./src/pglite.ts", import.meta.url)),
      "@tinker/drizzle/migrations": fileURLToPath(new URL("./src/migrations.ts", import.meta.url)),
    },
    /** Skip Stryker's leftover sandbox copies of the tests (gitignored, not ours). */
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**"],
    /** PGlite boots in-process; its first start passes 5 s when many test lanes share the CPU. */
    testTimeout: 30_000,
    server: { deps: { inline: ["vite-plus"] } },
  },
});
