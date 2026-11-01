import { resource } from "@tinker/core";

import type { SyncPart } from "./part";

/** The sync part, off: no capsules, no router options, and nothing bound to the page. */
export const sync: SyncPart.Router<Record<never, never>> = {
  capsules: [],
  router: resource({
    label: "sync.off.router",
    factory: () => ({ options: {}, bind: () => {} }),
  }),
};
