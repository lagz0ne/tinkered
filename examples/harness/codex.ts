import { createScope } from "@tinker/core";
import { codex, harness } from "@tinker/harness";

/** The real adapter (needs Codex auth — not run by tests): prints `text` while streaming. */
export async function tour(): Promise<string> {
  const coder = harness({ label: "coder", adapter: codex });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ input: prompt }) });
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
