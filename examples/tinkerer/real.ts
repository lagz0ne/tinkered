import { readFileSync } from "node:fs";
import { createScope, namespace } from "@tinker/core";
import { tinkerer } from "@tinker/tinkerer";

/** Two real coders from one graph (needs a Muse token; not run by tests). */
export async function tour(): Promise<string> {
  const keyFile = process.env.MUSE_TOKEN_FILE ?? "/home/paseo/pilot/.muse-token";
  const key = readFileSync(keyFile, "utf8").trim();
  const coder = tinkerer();
  const common = {
    model: "muse-spark-1.3-contributor",
    baseUrl: "https://api.meta.ai/v1",
    headers: { authorization: `Bearer ${key}` },
  };
  const a = namespace({ tags: [coder.config({ ...common, system: "You are coder A." })] });
  const b = namespace({ tags: [coder.config({ ...common, system: "You are coder B." })] });
  const scope = createScope();
  const session = scope.createSession();
  const prompt = process.argv[2] ?? "Say hi in five words.";
  for (const { name, ns } of [
    { name: "A", ns: a },
    { name: "B", ns: b },
  ]) {
    session.controller(coder.text, { ns }).watch((next, prev) => {
      process.stdout.write(next.slice(prev.length));
    });
    process.stdout.write(`${name}: `);
    const reply = await session.run(coder.turn, { input: prompt, ns });
    process.stdout.write("\n");
    console.log(`${name} usage: ${reply.usage.input} in, ${reply.usage.output} out`);
  }
  const result = session.resolve(coder.text, { ns: b });
  await scope.close();
  return result;
}
