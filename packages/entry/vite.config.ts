import { fileURLToPath } from "node:url";

import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  pack: {
    entry: {
      cmd: "src/cmd.ts",
      server: "src/server.ts",
    },
    deps: { resolveDepSubpath: true, neverBundle: ["bun"] },
    dts: { generator: "tsgo" },
    exports: true,
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  fmt: {},
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**"],
    server: { deps: { inline: ["vite-plus"] } },
  },
});
