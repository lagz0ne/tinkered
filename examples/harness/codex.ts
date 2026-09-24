import { createScope, operation } from "@tinker/core";
import { codex, harness } from "@tinker/harness";

/** Parse the author's prompt input: a plain string, trimmed of padding. */
function parsePrompt(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("bad prompt");
  return raw;
}

// Units first, declared once at module level (ADR 0057); `tour` wires a scope and runs them.
const coder = harness({ label: "coder", adapter: codex });
const ask = operation({
  label: "coder.ask",
  input: parsePrompt,
  depends: { send: coder.send },
  run: async ({ send }, ctx) => {
    const result = await send.run({ input: { input: ctx.input } });
    return result;
  },
});

/** The real adapter (needs Codex auth — not run by tests): prints `text` while streaming. */
export async function tour(): Promise<string> {
  const scope = createScope({
    tags: [codex.options({ workingDirectory: process.cwd(), sandboxMode: "read-only" })],
  });
  const session = scope.createSession();
  session.controller(coder.text).watch((next) => process.stdout.write(next));
  await session.run(ask, { input: "say hello in five words" });
  const answer = session.resolve(coder.text);
  await scope.close();
  return answer;
}
