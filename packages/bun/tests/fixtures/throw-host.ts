import { serve } from "@/serve";

/**
 * A host whose command fails as `THROW` says: `config` (a MissingConfig), `url` (a bad URL),
 * `plain` (any other throw), `root` (it starts, then its root fails), `slow` (a start that
 * waits for the stop, then throws its reason).
 */
const mode = process.env.THROW;

await serve(
  async ({ signal }) => {
    if (mode === "config") {
      throw Object.assign(new Error("MissingConfig"), {
        kind: "MissingConfig",
        payload: { key: "url" },
      });
    }
    if (mode === "url") new URL("not a url");
    if (mode === "plain") throw new Error("broke");
    if (mode === "slow") {
      console.log("starting");
      await new Promise((resolve) => signal.addEventListener("abort", resolve));
      throw signal.reason;
    }
    return {
      fetch: async () => new Response("cmd"),
      closed: Promise.resolve({ status: "failed", error: new Error("root broke") } as never),
    };
  },
  { "/*": new Response("page") },
);
