import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: { "@tinker/nats/testing": fileURLToPath(new URL("./src/testing.ts", import.meta.url)) },
  },
  pack: {
    entry: ["src/index.ts", "src/testing.ts"],
    deps: { resolveDepSubpath: true, neverBundle: ["@tinker/core", "@nats-io/transport-node"] },
    dts: { generator: "tsgo" },
    exports: true,
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  fmt: {},
  test: {
    testTimeout: 15000,
    hookTimeout: 120000,
    /** Skip Stryker's leftover sandbox copies of the tests (gitignored, not ours). */
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**"],
    server: { deps: { inline: ["vite-plus"] } },
  },
});
