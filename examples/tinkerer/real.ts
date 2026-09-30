import { createScope } from "@tinker/core";
import { backend, type HttpClient } from "@tinker/http";
import type { Tinkerer } from "@tinker/tinkerer";
import { z } from "zod";
import { a, b, coder } from "./coder.ts";
import { checkClosed, raise } from "./errors.ts";

const settings = z.object({
  apiKey: z.string().trim().min(1),
  baseUrl: z.url({ protocol: /^https?$/ }),
  model: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
});

export declare namespace Tour {
  type Reply = { name: string; text: string; usage: Tinkerer.Usage };
}

/** Validate settings before opening a root; the demo supplies its own HTTP backend. */
export async function tour(raw: unknown, transport?: HttpClient.Backend): Promise<Tour.Reply[]> {
  const parsed = settings.safeParse(raw);
  if (!parsed.success) {
    raise("InvalidSettings", { fields: parsed.error.issues.map((issue) => issue.path.join(".")) });
  }
  const { apiKey, baseUrl, model, prompt } = parsed.data;
  const stop = new AbortController();
  const root = createScope({
    signal: stop.signal,
    tags: [
      coder.config({ model, baseUrl, headers: { authorization: `Bearer ${apiKey}` } }),
      ...(transport === undefined ? [] : [backend(transport)]),
    ],
  });
  let completed = false;
  try {
    await root.ready;
    const session = root.createSession();
    const replies: Tour.Reply[] = [];
    for (const { name, ns } of [
      { name: "A", ns: a },
      { name: "B", ns: b },
    ]) {
      const reply = await session.run(coder.turn, { input: prompt, ns });
      replies.push({ name, text: session.resolve(coder.text, { ns }), usage: reply.usage });
    }
    completed = true;
    return replies;
  } finally {
    stop.abort();
    const result = await root.closed;
    if (completed) checkClosed(result);
  }
}

if (import.meta.main) {
  const replies = await tour({
    apiKey: process.env.TINKERER_API_KEY,
    baseUrl: process.env.TINKERER_BASE_URL,
    model: process.env.TINKERER_MODEL,
    prompt: process.env.TINKERER_PROMPT ?? "Say hi in five words.",
  });
  process.stdout.write(`${JSON.stringify(replies, null, 2)}\n`);
}
