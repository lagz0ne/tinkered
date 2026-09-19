import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    deps: {
      resolveDepSubpath: true,
      neverBundle: ["@tinker/core"],
    },
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
    server: { deps: { inline: ["vite-plus"] } },
    alias: {
      "@tinker/sync": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
});
