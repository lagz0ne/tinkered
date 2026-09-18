import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    deps: {
      resolveDepSubpath: true,
      neverBundle: ["@tinker/core", "@modelcontextprotocol/sdk", "zod"],
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
