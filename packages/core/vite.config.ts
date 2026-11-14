import { fileURLToPath } from "node:url";

import { defineConfig } from "vite-plus";

import { privateFields } from "./build/private-fields";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@tinkered/core/testing": fileURLToPath(new URL("./src/testing.ts", import.meta.url)),
      /** The backend kit imports Core by its name: here that is this source, so one Core runs. */
      "@tinkered/core": fileURLToPath(new URL("./src/main.ts", import.meta.url)),
    },
  },
  pack: {
    entry: { index: "src/main.ts", testing: "src/testing.ts" },
    deps: { resolveDepSubpath: true },
    dts: {
      generator: "tsgo",
    },
    exports: true,
    minify: true,
    /** Keep map files for local checks; the published file list omits them. */
    sourcemap: "hidden",
    /** Rename Core's private fields (core/size-build); `build/private-fields.ts` says why it is safe. */
    plugins: [privateFields()],
    outputOptions: {
      comments: { annotation: false },
      /** rpc and remoteData get their own chunk, so an app that skips them drops it (ADR 0130). */
      codeSplitting: {
        groups: [
          {
            name: "rpc",
            test: /src[\\/](rpc|remote-data)[\w-]*\.ts$/,
            includeDependenciesRecursively: false,
          },
        ],
      },
    },
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
