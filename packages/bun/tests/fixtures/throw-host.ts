import { serve } from "@/serve";

/**
 * A host whose command fails as `THROW` says: `config` (a MissingConfig), `url` (a bad URL),
 * `tag` (a MissingTag), `invalid` (a DataValidationFailed), `plain` (any other throw), `root`
 * (it starts, then its root fails), `teardown` (its root closes with a teardown error), `slow`
 * (a start that waits for the stop, then throws its reason), `other` (the same, but throws its
 * own error).
 */
const mode = process.env.THROW ?? "root";

const fault = (kind: string, payload: object) => Object.assign(new Error(kind), { kind, payload });

const stopped = async (signal: AbortSignal) => {
  console.log("starting");
  await new Promise((resolve) => signal.addEventListener("abort", resolve));
};

const root = (closed: object) => ({
  fetch: async () => new Response("cmd"),
  closed: Promise.resolve(closed as never),
});

const modes: Record<string, (signal: AbortSignal) => Promise<unknown>> = {
  config: async () => {
    throw fault("MissingConfig", { key: "url" });
  },
  tag: async () => {
    throw fault("MissingTag", { label: "x" });
  },
  invalid: async () => {
    throw fault("DataValidationFailed", { label: "x" });
  },
  url: async () => new URL("not a url"),
  plain: async () => {
    throw new Error("broke");
  },
  slow: async (signal) => {
    await stopped(signal);

    throw signal.reason;
  },
  other: async (signal) => {
    await stopped(signal);

    throw new Error("other broke");
  },
  teardown: async () => root({ status: "closed", teardownErrors: [new Error("teardown broke")] }),
  root: async () => root({ status: "failed", error: new Error("root broke") }),
};

await serve(({ signal }) => modes[mode]!(signal) as never, { "/*": new Response("page") });
