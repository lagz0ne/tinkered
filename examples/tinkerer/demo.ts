import { createScope } from "@tinker/core";
import { backend } from "@tinker/http";
import { a, b, coder } from "./coder.ts";
import { checkClosed } from "./errors.ts";
import { recorded } from "./recorded.ts";

if (import.meta.main) {
  const requestStop = new AbortController();
  const stop = new AbortController();
  const root = createScope({
    signal: stop.signal,
    tags: [
      coder.config({
        model: "demo-model",
        baseUrl: "https://demo.invalid/v1",
        headers: { authorization: "Bearer demo-key" },
      }),
      backend(recorded),
    ],
  });
  const shutdown = (): void => requestStop.abort();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  const replies = [];
  let completed = false;
  try {
    await root.ready;
    const session = root.createSession();
    for (const { name, ns } of [
      { name: "A", ns: a },
      { name: "B", ns: b },
    ]) {
      if (requestStop.signal.aborted) break;
      const reply = await session.run(coder.turn, { input: "Say hi in five words.", ns });
      if (requestStop.signal.aborted) break;
      replies.push({ name, text: session.resolve(coder.text, { ns }), usage: reply.usage });
    }
    completed = true;
  } finally {
    stop.abort();
    const result = await root.closed;
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    if (completed) checkClosed(result);
  }
  process.stdout.write(`${JSON.stringify(replies, null, 2)}\n`);
}
