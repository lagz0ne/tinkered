import { fileURLToPath } from "node:url";

import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    /** Its own `src`, so Stryker's sandbox tests its own mutated copy, not the tree above it. */
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  pack: {
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
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**"],
  },
});
