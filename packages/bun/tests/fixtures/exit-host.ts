import { run } from "@/run";

/** A host whose command exits 64 during start, as `cmds/server.ts` does on extra args. */
await run(({ exit }) => {
  exit(64);
  return { closed: Promise.resolve() };
});
