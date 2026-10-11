import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
    "*.md": "node scripts/prose-lint.mjs",
  },
  // Markdown fences keep the line breaks we wrote (docs/writing-style.md, 60-char rule).
  fmt: { embeddedLanguageFormatting: "off" },
  lint: {
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "tinker", specifier: "./tools/lint/blank-lines.mjs" },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      complexity: ["error", { max: 8 }],
      "tinker/blank-lines": "error",
    },
    options: { typeAware: true, typeCheck: true },
    // The flight reference answer is its own app; run-reference checks it in the trial image.
    ignorePatterns: ["tools/flight-trial/reference/**"],
    // Trial fixtures keep the layout their runs recorded.
    overrides: [
      {
        files: ["tools/writer-trial/**", "tools/flight-trial/**"],
        rules: { "tinker/blank-lines": "off" },
      },
    ],
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
