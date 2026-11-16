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
      "not-in-page": "src/not-in-page.ts",
    },
    deps: { resolveDepSubpath: true, neverBundle: ["bun"] },
    dts: { generator: "tsgo" },
    exports: {
      exclude: ["not-in-page"],
      /** A page bundler resolves the `browser` condition first, so a backend entry never lands in a page. */
      customExports(exports) {
        for (const entry of ["./cmd", "./server"]) {
          exports[entry] = { browser: "./dist/not-in-page.mjs", default: exports[entry] };
        }
        return exports;
      },
    },
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  fmt: {},
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**"],
    server: { deps: { inline: ["vite-plus"] } },
  },
});
