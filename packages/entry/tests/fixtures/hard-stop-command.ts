import { createMainHost, defineMain } from "@/cmd";

/** A command that exits but keeps its root open for a minute: only the hard stop ends it sooner. */
const main = defineMain(({ exit }) => {
  exit(1);
  return { closed: Bun.sleep(60_000) };
});

createMainHost(main, { env: {}, stdout: process.stdout, stderr: process.stderr, graceMs: 1 });
