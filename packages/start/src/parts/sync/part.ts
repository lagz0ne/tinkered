import type { Capsule, Many, Resource } from "@tinker/core";

import type { Sync } from "./envelopes";

/**
 * The shape of the sync part for the router entry, in a file that imports no seam name, so an
 * app with sync off type-checks its off module without them.
 */
export declare namespace SyncPart {
  /** What the router entry spreads into its router options while sync is on. */
  type Options = {
    context: Sync.RouterContext;
    dehydrate: () => Sync.Snapshot;
    hydrate: (raw: unknown) => Promise<void>;
  };
  /** What a part gives the router entry: app root capsules, and a resource read from it. */
  type Router<O> = {
    readonly capsules: Many<Capsule.Installable>;
    readonly router: Resource.Handle<{ options: O; bind(close: () => Promise<void>): void }>;
  };
}
