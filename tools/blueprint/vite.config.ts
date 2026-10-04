import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/main.ts"],
    banner: ({ fileName }) => (fileName === "main.mjs" ? "#!/usr/bin/env node" : undefined),
    deps: {
      resolveDepSubpath: true,
      neverBundle: ["@tinker/core", "zod", "yaml", "ai"],
    },
    dts: {
      generator: "tsgo",
    },
    exports: false,
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
