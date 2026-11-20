import { defineConfig } from "vite-plus";

import base from "./vite.config";

/**
 * The mutation lane's Vitest config: Stryker reads it, `vp test` keeps `vite.config.ts`. A browser
 * test waits 15 s by default before it fails. A broken mutant fails several tests one after another,
 * so those waits ran past Stryker's 60 s limit and a caught mutant counted as a timeout. 8 s still
 * covers the slowest real test (about 5 s).
 */
export default defineConfig({
  ...base,
  test: { ...base.test, testTimeout: 8000 },
});
