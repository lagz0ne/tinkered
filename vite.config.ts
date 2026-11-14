import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
    "*.md": "node scripts/prose-lint.mjs",
  },
  // Markdown fences keep the line breaks we wrote (docs/writing-style.md, 60-char rule).
  fmt: {
    embeddedLanguageFormatting: "off",
    sortImports: true,
    // Trial fixtures keep the import order their runs recorded.
    overrides: [
      {
        files: ["tools/writer-trial/**", "tools/flight-trial/**", "docs/roadmap/**"],
        options: { sortImports: false },
      },
    ],
  },
  lint: {
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import"],
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "tinker", specifier: "./packages/analyze/lint/index.mjs" },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      complexity: ["error", { max: 8 }],
      "tinker/blank-lines": "error",
      "tinker/body-steps": "error",
      curly: ["error", "multi-line"],
      "import/no-relative-parent-imports": "error",
      // Misreads Vite's `?raw` text imports as missing default exports.
      "import/default": "off",
    },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      // Plain Node scripts have no tsconfig, so `@/` cannot reach them.
      {
        files: ["**/*.mjs", "**/*.js", "**/*.cjs"],
        rules: { "import/no-relative-parent-imports": "off" },
      },
      // A second source folder next to src/ (blueprint's tinker/): no `@/` names it.
      {
        files: ["tools/blueprint/**"],
        rules: { "import/no-relative-parent-imports": "off" },
      },
      // The backend kit stays in Core's tests (ADR 0140, repo only); Bun reaches it by path.
      {
        files: ["packages/bun/tests/backend-kit.test.ts"],
        rules: { "import/no-relative-parent-imports": "off" },
      },
      // Trial fixtures keep the layout their runs recorded.
      {
        files: ["tools/writer-trial/**", "tools/flight-trial/**", "docs/roadmap/**"],
        rules: {
          "tinker/blank-lines": "off",
          "tinker/body-steps": "off",
          curly: "off",
          "import/no-relative-parent-imports": "off",
        },
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
