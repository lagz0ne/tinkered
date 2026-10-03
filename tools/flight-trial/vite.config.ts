import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    deps: { neverBundle: ["@tinker/core", "zod"] },
    dts: { generator: "tsgo" },
    exports: false,
  },
  test: { exclude: ["**/node_modules/**", "**/dist/**"] },
});
