import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import { privateFields } from "./build/private-fields.ts";

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
    sourcemap: true,
    /** Rename Core's private fields (core/size-build); `build/private-fields.ts` says why it is safe. */
    plugins: [privateFields()],
    outputOptions: { comments: { annotation: false } },
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
    /**
     * Skip Stryker's leftover sandbox copies of the tests (gitignored, not ours), and the build's
     * guard tests: each packs Core, so they run in the dist lane (`vite.dist.config.ts`).
     */
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**", "build/**"],
    server: { deps: { inline: ["vite-plus"] } },
  },
});
