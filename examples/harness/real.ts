import { createScope } from "@tinker/core";
import { claudeCode, harness } from "@tinker/harness";

/** The real adapter (needs Claude Code auth — not run by tests): prints `text` while streaming. */
export async function tour(): Promise<string> {
  const coder = harness({ label: "coder", adapter: claudeCode });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
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
