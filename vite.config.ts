import { defineConfig } from "vite-plus";

export default defineConfig({
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
    // The flight reference answer is its own app; run-reference checks it in the trial image.
    ignorePatterns: ["tools/flight-trial/reference/**"],
  },
  run: {
    cache: { scripts: false, tasks: true },
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**", ".claude/**"],
  },
});
