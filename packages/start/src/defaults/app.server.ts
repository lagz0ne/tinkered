import type { Capsule, Many } from "@tinker/core";

import type { Env } from "../env";

/** The base's empty server seam: an app with no src/lib/tinker.server.ts adds no capsules. */
export const extensions: Many<Capsule.Installable> = [];

/** The base's empty settings: the app fills no settings tags. */
export const settings: Env.Read = () => [];
