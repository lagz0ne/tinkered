import { createScope, operation } from "@tinker/core";
import { claudeCode, harness } from "@tinker/harness";
import { z } from "zod";
import { checkClosed } from "./errors.ts";

const coder = harness({ label: "coder", adapter: claudeCode });
const ask = operation({
  label: "coder.ask",
  input: z.string().trim().min(1),
  depends: { send: coder.send },
  run: ({ send }, ctx) => send.run({ input: { prompt: ctx.input } }),
});

if (import.meta.main) {
  const stop = new AbortController();
  const root = createScope({
    signal: stop.signal,
    tags: [claudeCode.options({ cwd: process.cwd(), permissionMode: "plan" })],
  });
  let completed = false;
  const onStop = () => stop.abort();
  process.once("SIGINT", onStop);
  process.once("SIGTERM", onStop);
  try {
    await root.ready;
    const session = root.createSession();
    session
      .controller(coder.text)
      .watch((next, previous) => process.stdout.write(next.slice(previous.length)));
    await session.run(ask, { input: "say hello in five words" });
    completed = true;
  } finally {
    stop.abort();
    const result = await root.closed;
    process.off("SIGINT", onStop);
    process.off("SIGTERM", onStop);
    if (completed) checkClosed(result);
  }
  process.stdout.write("\n");
}
