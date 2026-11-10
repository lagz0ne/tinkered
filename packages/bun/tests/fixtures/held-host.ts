import { capsule, createScope } from "@tinker/core";

import { run } from "@/run";
import { serve } from "@/serve";

/**
 * A host whose start waits on a held lock, as a database start can. It prints "starting", and
 * the lock goes only after the stop: the stop comes while `serve` waits on `next()`.
 */
await run(({ env, signal, stdout }) => {
  const held = capsule({
    label: "held",
    hooks: {
      async start({ next }) {
        stdout.write("starting\n");
        await new Promise((resolve) => signal.addEventListener("abort", resolve));
        await next();
      },
    },
  });
  return createScope({
    signal,
    capsules: [serve({ port: Number(env.PORT), stdout }), held],
  });
});
