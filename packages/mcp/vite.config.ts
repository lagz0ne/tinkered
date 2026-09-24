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
    /** Skip Stryker's leftover sandbox copies of the tests (gitignored, not ours). */
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**"],
    server: { deps: { inline: ["vite-plus"] } },
  },
});
