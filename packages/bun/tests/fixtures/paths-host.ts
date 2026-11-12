import { createScope } from "@tinkered/core";

import { run } from "@/run";
import { serve } from "@/serve";

import { handler } from "./handler";

/**
 * A host that also forwards `/mcp` and `/.well-known/*` to its command. The command answers "cmd"
 * on every path it gets; every other path gets "page". It runs until a signal stops it.
 */
await run(({ env, signal, stdout }) => {
  const cmd = handler({ answer: () => new Response("cmd") });
  const pages = { "/*": new Response("page") };
  const paths = ["/mcp", "/.well-known/*"];
  return createScope({
    signal,
    capsules: [serve({ port: Number(env.PORT), pages, paths, handlers: [cmd], stdout }), cmd],
  });
});
