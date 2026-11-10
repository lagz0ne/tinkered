import { plugin } from "bun";

/** `bun test` maps a `vitest` import to `bun:test`, but not `vite-plus/test`: this maps it too. */
plugin({
  name: "vite-plus-test",
  setup(build) {
    build.onResolve({ filter: /^vite-plus\/test$/ }, () => ({
      path: "bun:test",
      namespace: "vpt",
    }));
    build.onLoad({ filter: /.*/, namespace: "vpt" }, () => ({
      contents: 'export * from "bun:test";',
      loader: "js",
    }));
  },
});
