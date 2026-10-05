import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: { "@tinker/core/testing": fileURLToPath(new URL("./src/testing.ts", import.meta.url)) },
  },
  pack: {
    entry: ["src/index.ts", "src/testing.ts"],
    deps: { resolveDepSubpath: true },
    dts: {
      generator: "tsgo",
    },
    exports: true,
    minify: true,
    sourcemap: "hidden",
    /** This private shared chunk is versioned with the package. */
    outputOptions: { chunkFileNames: "s.mjs" },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    /** Skip Stryker's leftover sandbox copies of the tests (gitignored, not ours). */
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**"],
    server: { deps: { inline: ["vite-plus"] } },
  },
});
