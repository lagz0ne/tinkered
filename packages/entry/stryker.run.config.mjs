/**
 * The panic hook's lane. It runs in a child process its test spawns; a child gets the active
 * mutant through the environment, but its coverage never reaches the runner. So each mutant runs
 * the one test file that spawns it, and stops at its first failing test.
 */
export default {
  testRunner: "command",
  commandRunner: { command: "bun test --bail tests/panics.test.ts" },
  coverageAnalysis: "off",
  mutate: ["src/cmd/panics.ts"],
  ignorePatterns: ["dist"],
  tsconfigFile: "tsconfig.stryker-none.json",
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: { fileName: "reports/mutation/run.json" },
  thresholds: { high: 90, low: 75, break: 85 },
  tempDirName: ".stryker-tmp",
  concurrency: 2,
  timeoutMS: 15000,
};
