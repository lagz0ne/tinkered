import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    deps: { resolveDepSubpath: true, neverBundle: ["@tinker/core", "drizzle-orm"] },
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
    /** PGlite boots in-process; its first start passes 5 s when many test lanes share the CPU. */
    testTimeout: 30_000,
    server: { deps: { inline: ["vite-plus"] } },
  },
});
