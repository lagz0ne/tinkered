import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["main.ts"],
    deps: { neverBundle: ["@tinker/core"] },
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
    include: ["*.test.ts"],
    server: { deps: { inline: ["vite-plus"] } },
  },
});
