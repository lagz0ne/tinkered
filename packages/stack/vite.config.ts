import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: { "@tinker/stack/dev": fileURLToPath(new URL("./src/dev.ts", import.meta.url)) },
  },
  pack: {
    entry: ["src/index.ts", "src/dev.ts"],
    minify: true,
    deps: {
      resolveDepSubpath: true,
      neverBundle: [
        "@tinker/core",
        "vite-plus",
        "@nats-io/transport-node",
        "@tinker/hono",
        "@tinker/nats",
        "@tinker/drizzle",
        "@electric-sql/pglite",
        "drizzle-orm",
        "@hono/node-server",
      ],
    },
    dts: { generator: "tsgo" },
    exports: true,
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  fmt: {},
  test: {
    testTimeout: 30_000,
    /** Skip Stryker's leftover sandbox copies of the tests (gitignored, not ours). */
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**"],
    server: { deps: { inline: ["vite-plus"] } },
  },
});
