/**
 * Mutation on Bun, as in packages/bun: Stryker runs on Node, the tests run in `bun test`, and
 * each mutant runs only the tests that reach it (per-test coverage). The panic hook runs only in
 * the child process its test spawns, where no coverage is seen, so it has its own lane:
 * `stryker.run.config.mjs`. `not-in-page` runs only in a page build, from `dist`; its proof is
 * `tests/page.node-test.mjs`, which CI runs after the build.
 */
export default {
  appendPlugins: ["@hughescr/stryker-bun-runner"],
  testRunner: "bun",
  coverageAnalysis: "perTest",
  mutate: ["src/**/*.ts", "!src/cmd/panics.ts", "!src/not-in-page.ts"],
  ignorePatterns: ["dist"],
  tsconfigFile: "tsconfig.stryker-none.json",
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  thresholds: { high: 90, low: 75, break: 85 },
  tempDirName: ".stryker-tmp",
  concurrency: 2,
  timeoutMS: 15000,
  bun: { timeout: 120000 },
};
