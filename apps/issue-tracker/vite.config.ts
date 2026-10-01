import { defineConfig, type ProxyOptions } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";
import react from "@vitejs/plugin-react";

class PageTestTarget {
  protocol = "http:";
  host = "127.0.0.1";
  get port() {
    return Number(new URL(process.env.TINKERED_PAGE_TEST_URL ?? "http://127.0.0.1:9").port);
  }
}

const pageProxy: ProxyOptions = { target: new PageTestTarget() };

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: mode === "test" ? { proxy: { "/api": pageProxy, "/sync": pageProxy } } : undefined,
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
          include: ["tests/page-?*.test.tsx"],
          globalSetup: "./tests/page-setup.ts",
          fileParallelism: false,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            commands: {
              readSyncRequests({ project }) {
                return project.getProvidedContext().pageTraffic.syncs;
              },
              selectPageServer({ project }, down: boolean) {
                const context = project.getProvidedContext();
                process.env.TINKERED_PAGE_TEST_URL = down ? context.unavailable : context.tracker;
              },
            },
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: 2,
  },
}));
