import { capsule, tag } from "@tinker/core";

import type { Handler } from "@/serve";

const answer = tag<Handler["fetch"]>({ label: "handler.answer" });
const closing = tag<(() => void) | null>({ label: "handler.closing", default: null });

/** A test handler: `fetch` answers each request; `closing` runs when the root closes. */
export const handler = capsule({
  label: "handler",
  config: { answer: answer.required, closing },
  hooks: {
    async start({ config, next }): Promise<Handler> {
      await next();
      return { fetch: config.answer };
    },
    async close({ config, next }) {
      config.closing?.();
      return next();
    },
  },
});
