import { readFileSync } from "node:fs";
import { createScope } from "@tinker/core";
import { tinkerer } from "@tinker/tinkerer";

/** The real model call (needs a Muse token — not run by tests): prints `text` as it streams. */
export async function tour(): Promise<string> {
  const keyFile = process.env.MUSE_TOKEN_FILE ?? "/home/paseo/pilot/.muse-token";
  const key = readFileSync(keyFile, "utf8").trim();
  const coder = tinkerer({ label: "coder" });
  const scope = createScope({
    tags: [
      coder.config({
        model: "muse-spark-1.3-contributor",
        baseUrl: "https://api.meta.ai/v1",
        headers: { authorization: `Bearer ${key}` },
      }),
    ],
  });
  const session = scope.createSession();
  session.controller(coder.text).watch((next, prev) => {
    process.stdout.write(next.slice(prev.length));
  });
  const prompt = process.argv[2] ?? "Say hi in five words.";
  const reply = await session.run(coder.turn, { input: prompt });
  process.stdout.write("\n");
  console.log(`usage: ${reply.usage.input} in, ${reply.usage.output} out`);
  await scope.close();
  return reply.message.content ?? "";
}
