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
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**", ".claude/**"],
  },
});
