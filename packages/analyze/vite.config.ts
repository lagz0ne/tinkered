import { fileURLToPath } from "node:url";

import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    /** Its own `src`, so Stryker's sandbox tests its own mutated copy, not the tree above it. */
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  pack: {
    entry: { index: "src/index.ts", cli: "src/cli.ts" },
    dts: { generator: "tsgo" },
    exports: false,
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  fmt: {},
  test: {
    /** Skip Stryker's leftover sandbox copies of the tests (gitignored, not ours). */
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**"],
    server: { deps: { inline: ["vite-plus"] } },
  },
});
