import { createScope, namespace, operation } from "@tinker/core";
import { harness } from "@tinker/harness";
import { demo } from "./demo.ts";
import { checkClosed } from "./errors.ts";

/** One graph serves both namespaces; each keeps its own conversation and text. */
const coder = harness({ adapter: demo });
const a = namespace({
  tags: demo.options({ id: "agent-a", words: ["Hello"], reply: "Hello" }),
});
const b = namespace({
  tags: demo.options({ id: "agent-b", words: ["Hi", " again"], reply: "Hi again" }),
});
const relay = operation({
  label: "relay",
  depends: { send: coder.send },
  run: async ({ send }) => {
    const first = await send.run({ input: "first", ns: a });
    return send.run({ input: first, ns: b });
  },
});

/** Replays two turns without a network call, a process, or account access. */
export async function tour(): Promise<string> {
  const stop = new AbortController();
  const root = createScope({ signal: stop.signal });
  let completed = false;
  try {
    await root.ready;
    const session = root.createSession();
    const textA: string[] = [];
    const textB: string[] = [];
    session.controller(coder.text, { ns: a }).watch((next) => textA.push(next));
    session.controller(coder.text, { ns: b }).watch((next) => textB.push(next));
    const answer = await session.run(relay);
    const result = [
      answer,
      session.resolve(coder.text, { ns: a }),
      session.resolve(coder.text, { ns: b }),
      session.resolve(coder.id, { ns: a }),
      session.resolve(coder.id, { ns: b }),
      textA.join("|"),
      textB.join("|"),
      [
        ...session.resolve(coder.events, { ns: a }),
        ...session.resolve(coder.events, { ns: b }),
      ].join("|"),
    ].join(";");
    completed = true;
    return result;
  } finally {
    stop.abort();
    const result = await root.closed;
    if (completed) checkClosed(result);
  }
}

if (import.meta.main) process.stdout.write(`${await tour()}\n`);
