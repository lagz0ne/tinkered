import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

export default defineConfig({
  resolve: { tsconfigPaths: true },
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
    /** A server render has no DOM, so its tests run in Node, apart from the browser tests. */
    projects: [
      {
        extends: true,
        test: {
          name: "browser",
          exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "**/.stryker-tmp/**",
            "**/*.server.test.tsx",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "server",
          include: ["tests/**/*.server.test.tsx"],
          environment: "node",
          browser: { enabled: false },
        },
      },
    ],
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
