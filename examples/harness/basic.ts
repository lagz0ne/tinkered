import { createScope, namespace, operation } from "@tinker/core";
import { harness } from "@tinker/harness";
import { demo } from "./demo.ts";
import { checkClosed } from "./errors.ts";

/** One graph serves both namespaces; each keeps its own conversation and text. */
export const coder = harness({ adapter: demo });
export const firstAgent = namespace({
  tags: demo.options({ id: "agent-a", words: ["Hello"], reply: "Hello" }),
});
export const secondAgent = namespace({
  tags: demo.options({ id: "agent-b", words: ["Hi", " again"], reply: "Hi again" }),
});
export const relay = operation({
  label: "relay",
  depends: { send: coder.send },
  run: async ({ send }) => {
    const first = await send.run({ input: "first", ns: firstAgent });
    return send.run({ input: first, ns: secondAgent });
  },
});

if (import.meta.main) {
  const stop = new AbortController();
  const root = createScope({ signal: stop.signal });
  let output: string;
  let completed = false;
  const onStop = () => stop.abort();
  process.once("SIGINT", onStop);
  process.once("SIGTERM", onStop);
  try {
    await root.ready;
    const session = root.createSession();
    const textA: string[] = [];
    const textB: string[] = [];
    session.controller(coder.text, { ns: firstAgent }).watch((next) => textA.push(next));
    session.controller(coder.text, { ns: secondAgent }).watch((next) => textB.push(next));
    const answer = await session.run(relay);
    output = [
      answer,
      session.resolve(coder.text, { ns: firstAgent }),
      session.resolve(coder.text, { ns: secondAgent }),
      session.resolve(coder.id, { ns: firstAgent }),
      session.resolve(coder.id, { ns: secondAgent }),
      textA.join("|"),
      textB.join("|"),
      [
        ...session.resolve(coder.events, { ns: firstAgent }),
        ...session.resolve(coder.events, { ns: secondAgent }),
      ].join("|"),
    ].join(";");
    completed = true;
  } finally {
    stop.abort();
    const result = await root.closed;
    process.off("SIGINT", onStop);
    process.off("SIGTERM", onStop);
    if (completed) checkClosed(result);
  }
  process.stdout.write(`${output}\n`);
}
