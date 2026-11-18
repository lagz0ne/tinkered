import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  pack: {
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
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**"],
  },
});
