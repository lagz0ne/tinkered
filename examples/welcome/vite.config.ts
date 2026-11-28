import { fileURLToPath } from "node:url";

import { gates } from "@tinkered/cli/config";
import { defineConfig } from "vite-plus";

const alias = { "@": fileURLToPath(new URL("src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  pack: {
    entry: ["cmds/server.ts"],
    deps: { neverBundle: ["@tinkered/core", "@tinkered/devtools"] },
    exports: false,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    server: { deps: { inline: ["vite-plus"] } },
  },
  lint: {
    jsPlugins: [{ name: "tinker", specifier: "@tinkered/cli/lint" }],
    rules: {
      "tinker/blank-lines": "error",
      "tinker/body-steps": "error",
      "tinker/cell-write": "warn",
    },
    options: { typeAware: true, typeCheck: true },
    overrides: [{ files: ["src/**"], rules: gates }],
  },
  fmt: {},
});
