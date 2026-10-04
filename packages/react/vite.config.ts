import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

export default defineConfig({
  pack: {
    deps: { resolveDepSubpath: true },
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
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    /** Skip Stryker's leftover sandbox copies of the tests (gitignored, not ours). */
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**"],
    server: { deps: { inline: ["vite-plus"] } },
    browser: {
      locators: {
        // Vitest v4 compatibility: keep partial, case-insensitive locator matching.
        // Remove after updating locators for full, case-sensitive matches.
        // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
        // https://vitest.dev/guide/migration/#locators-are-strict-by-default
        exact: false,
      },
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
