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
    /** Preserve call history until older tests no longer rely on setup or earlier calls. */
    clearMocks: false,
    /** Skip Stryker's leftover sandbox copies of the tests (gitignored, not ours). */
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**"],
    server: { deps: { inline: ["vite-plus"] } },
    browser: {
      locators: {
        /** Keep partial, case-insensitive matching until older locators use exact names. */
        exact: false,
      },
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
