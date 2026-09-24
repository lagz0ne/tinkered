import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    deps: { resolveDepSubpath: true, neverBundle: ["@tinker/core", "drizzle-orm"] },
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
    /** Skip Stryker's leftover sandbox copies of the tests (gitignored, not ours). */
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**"],
    /** PGlite boots in-process; its first start passes 5 s when many test lanes share the CPU. */
    testTimeout: 30_000,
    server: { deps: { inline: ["vite-plus"] } },
  },
});
