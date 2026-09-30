import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
  test: {
    include: ["*.test.ts"],
    /** Allow PGlite to start while other test packages share the CPU. */
    testTimeout: 30_000,
    server: { deps: { inline: ["vite-plus"] } },
  },
});
