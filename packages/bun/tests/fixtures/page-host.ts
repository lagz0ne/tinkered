import { createScope } from "@tinker/core";

import { run } from "@/run";
import { serve } from "@/serve";

import { handler } from "./handler";

/**
 * A host with no extra paths. The command answers "cmd" on every path it gets; every other path
 * gets "page". It runs until a signal stops it; its root prints "closed" when it closes.
 */
await run(({ env, signal, stdout }) => {
  const cmd = handler({ answer: () => new Response("cmd"), closing: () => console.log("closed") });
  const pages = { "/*": new Response("page") };
  return createScope({
    signal,
    capsules: [serve({ port: Number(env.PORT), pages, handlers: [cmd], stdout }), cmd],
  });
});
