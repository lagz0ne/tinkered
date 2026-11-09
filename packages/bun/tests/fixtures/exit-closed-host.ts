import { run } from "@/run";

/**
 * A host whose command exits 64 during start after it built a root: its `closed` resolves only
 * after a short teardown, which prints "closed". The host must wait for it, and never serve.
 */
await run(({ exit }) => {
  exit(64);
  return { closed: Bun.sleep(100).then(() => console.log("closed")) };
});
