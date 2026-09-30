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
    server: { deps: { inline: ["vite-plus"] } },
  },
});
