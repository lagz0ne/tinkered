import { createScope, operation } from "@tinker/core";
import { codex, harness } from "@tinker/harness";
import { z } from "zod";
import { checkClosed } from "./errors.ts";

const coder = harness({ label: "coder", adapter: codex });
const ask = operation({
  label: "coder.ask",
  input: z.string().trim().min(1),
  depends: { send: coder.send },
  run: ({ send }, ctx) => send.run({ input: { input: ctx.input } }),
});

if (import.meta.main) {
  const requestStop = new AbortController();
  const stop = new AbortController();
  const root = createScope({
    signal: stop.signal,
    tags: [codex.options({ workingDirectory: process.cwd(), sandboxMode: "read-only" })],
  });
  let completed = false;
  const onStop = () => requestStop.abort();
  process.once("SIGINT", onStop);
  process.once("SIGTERM", onStop);
  try {
    await root.ready;
    if (!requestStop.signal.aborted) {
      const session = root.createSession();
      session
        .controller(coder.text)
        .watch((next, previous) => process.stdout.write(next.slice(previous.length)));
      await session.run(ask, { input: "say hello in five words" });
      if (!requestStop.signal.aborted) process.stdout.write("\n");
    }
    completed = true;
  } finally {
    stop.abort();
    const result = await root.closed;
    process.off("SIGINT", onStop);
    process.off("SIGTERM", onStop);
    if (completed) checkClosed(result);
  }
}
