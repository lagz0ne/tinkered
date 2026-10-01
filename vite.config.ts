import { defineConfig } from "vite-plus";

export default defineConfig({
  create: {
    templates: [
      { name: "stack-app", description: "A full Tinkered web app", template: "@tinker/create-app" },
    ],
  },
  staged: {
    "*": "vp check --fix",
    "*.md": "node scripts/prose-lint.mjs",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      complexity: ["error", { max: 8 }],
    },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: { scripts: false, tasks: true },
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**", ".claude/**"],
  },
});
