import { createScope } from "@tinkered/core";

import { run } from "@/run";
import { serve } from "@/serve";

import { handler } from "./handler";

/**
 * A host with no page, as `cmds/api.ts` in dev. It prints its args. The command answers "cmd",
 * or nothing for `/api/none`. It runs until a signal stops it.
 */
await run(({ args, env, signal, stdout }) => {
  console.log(`args ${JSON.stringify(args)}`);
  const cmd = handler({
    answer: (request) =>
      new URL(request.url).pathname === "/api/none" ? undefined : new Response("cmd"),
  });
  return createScope({
    signal,
    capsules: [serve({ port: Number(env.PORT), handlers: [cmd], stdout }), cmd],
  });
});
