import { serve } from "@/serve";

/**
 * A host with no page, as `cmds/api.ts` in dev. It prints its args. The command answers "cmd",
 * or nothing for `/api/none`. It runs until a signal stops it.
 */
await serve(async ({ args, signal }) => {
  console.log(`args ${JSON.stringify(args)}`);
  return {
    fetch: async (request: Request) =>
      new URL(request.url).pathname === "/api/none" ? undefined : new Response("cmd"),
    closed: new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve())),
  };
}, {});
