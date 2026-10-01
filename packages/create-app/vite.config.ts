import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: { dts: { generator: "tsgo" } },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**"],
    testTimeout: 300000,
    hookTimeout: 300000,
    fileParallelism: false,
  },
});
