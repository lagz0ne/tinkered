import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/main.ts"],
    banner: ({ fileName }) => (fileName === "main.mjs" ? "#!/usr/bin/env node" : undefined),
    deps: {
      resolveDepSubpath: true,
      neverBundle: ["@tinker/core", "@tinker/process", "zod", "yaml", "ai"],
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
  },
});
