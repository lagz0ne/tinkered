import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import base from "./vite.config.ts";

/** A built file in `dist`, by name. */
const built = (file: string) => fileURLToPath(new URL(`./dist/${file}`, import.meta.url));

/**
 * The build's lane (core/size-build): Core's tests against the built files, not the source, and
 * the guard tests in `build/`. The build renames private fields, so only this lane sees the code
 * users run. Run `vp pack` first.
 */
export default defineConfig({
  ...base,
  resolve: {
    alias: {
      "../src/index.ts": built("index.mjs"),
      "@tinker/core/testing": built("testing.mjs"),
    },
  },
  test: {
    ...base.test,
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**"],
  },
});
