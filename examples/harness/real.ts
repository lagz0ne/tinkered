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

/** Requires an authenticated SDK; the caller owns any streamed output. */
export async function tour(cwd: string, write: (text: string) => void): Promise<string> {
  const stop = new AbortController();
  const root = createScope({
    signal: stop.signal,
    tags: [claudeCode.options({ cwd, permissionMode: "plan" })],
  });
  let completed = false;
  try {
    await root.ready;
    const session = root.createSession();
    session.controller(coder.text).watch((next, previous) => write(next.slice(previous.length)));
    await session.run(ask, { input: "say hello in five words" });
    const result = session.resolve(coder.text);
    completed = true;
    return result;
  } finally {
    stop.abort();
    const result = await root.closed;
    if (completed) checkClosed(result);
  }
}

if (import.meta.main) {
  await tour(process.cwd(), (text) => process.stdout.write(text));
  process.stdout.write("\n");
}
