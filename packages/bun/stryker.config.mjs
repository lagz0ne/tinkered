/**
 * Mutation on Bun: Stryker runs on Node, the tests run in `bun test`, and each mutant runs only
 * the tests that reach it (per-test coverage). `run.ts` runs only inside the hosts the tests
 * spawn, where no coverage is seen, so it has its own lane: `stryker.run.config.mjs`.
 * In place: the backend kit test imports Core's `tests/kit`, outside this package, which a
 * sandbox copy of the package cannot reach (ADR 0140 step 1).
 */
export default {
  appendPlugins: ["@hughescr/stryker-bun-runner"],
  testRunner: "bun",
  coverageAnalysis: "perTest",
  mutate: ["src/**/*.ts", "!src/run.ts"],
  ignorePatterns: ["dist"],
  tsconfigFile: "tsconfig.stryker-none.json",
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  thresholds: { high: 90, low: 75, break: 85 },
  tempDirName: ".stryker-tmp",
  inPlace: true,
  concurrency: 2,
  timeoutMS: 15000,
  bun: { timeout: 120000 },
};
