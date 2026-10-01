import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
    outDir: "dist/client",
    emptyOutDir: true,
  },
  test: {
    server: { deps: { inline: ["vite-plus"] } },
    projects: [
      { extends: true, test: { name: "server", include: ["tests/?*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "browser",
          include: ["tests/page-client.test.tsx"],
          globalSetup: "./tests/page-setup.ts",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: 2,
  },
});
