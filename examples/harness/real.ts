import { createScope, operation } from "@tinker/core";
import { claudeCode, harness } from "@tinker/harness";

/** Parse the author's prompt input: a plain string, trimmed of padding. */
function parsePrompt(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("bad prompt");
  return raw;
}

/** The real adapter (needs Claude Code auth — not run by tests): prints `text` while streaming. */
export async function tour(): Promise<string> {
  const coder = harness({ label: "coder", adapter: claudeCode });
  const ask = operation({
    label: "coder.ask",
    input: parsePrompt,
    depends: { send: coder.send },
    run: async ({ send }, ctx) => {
      const result = await send.run({ input: { prompt: ctx.input } });
      return result;
    },
  });
  const scope = createScope({
    tags: [claudeCode.options({ cwd: process.cwd(), permissionMode: "plan" })],
  });
  const session = scope.createSession();
  session.controller(coder.text).watch((next) => process.stdout.write(next));
  await session.run(ask, { input: "say hello in five words" });
  const answer = session.resolve(coder.text);
  await scope.close();
  return answer;
}
