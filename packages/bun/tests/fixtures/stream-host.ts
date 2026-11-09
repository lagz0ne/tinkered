import { createScope } from "@tinker/core";

import { run } from "@/run";
import { serve } from "@/serve";

import { handler } from "./handler";

/**
 * A host whose `/api/stream` sends one chunk, stays quiet for 16 s, then sends a second and ends:
 * longer than Bun's 10 s default idle timeout, which fires up to 4 s late. It runs until a signal
 * stops it.
 */
await run(({ env, signal, stdout }) => {
  const cmd = handler({
    answer: () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("one\n"));
            await Bun.sleep(16_000);
            controller.enqueue(new TextEncoder().encode("two\n"));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/plain" } },
      ),
  });
  return createScope({
    signal,
    capsules: [serve({ port: Number(env.PORT), handlers: [cmd], stdout }), cmd],
  });
});
