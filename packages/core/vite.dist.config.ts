import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import base from "./vite.config.ts";

/** A built file in `dist`, by name. */
const built = (file: string) => fileURLToPath(new URL(`./dist/${file}`, import.meta.url));

/**
 * Core's tests against the built files, not the source (core/size-build): the build renames
 * private fields, so only this lane sees the code users run. Run `vp pack` first.
 */
export default defineConfig({
  ...base,
  resolve: {
    alias: {
      "../src/index.ts": built("index.mjs"),
      "@tinker/core/testing": built("testing.mjs"),
    },
  },
});
