import { createScope } from "@tinker/core";
import { a, b, coder } from "./coder.ts";
import { checkClosed } from "./errors.ts";
import { readSettings } from "./settings.ts";

if (import.meta.main) {
  const { apiKey, baseUrl, model, prompt } = readSettings({
    apiKey: process.env.TINKERER_API_KEY,
    baseUrl: process.env.TINKERER_BASE_URL,
    model: process.env.TINKERER_MODEL,
    prompt: process.env.TINKERER_PROMPT ?? "Say hi in five words.",
  });
  const stop = new AbortController();
  const root = createScope({
    signal: stop.signal,
    tags: coder.config({ model, baseUrl, headers: { authorization: `Bearer ${apiKey}` } }),
  });
  const shutdown = (): void => stop.abort();
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
      const reply = await session.run(coder.turn, { input: prompt, ns });
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
