import type { Capsule, Many } from "@tinker/core";

/** The base's empty client seam: an app with no src/lib/tinker.ts adds no capsules. */
export const extensions: Many<Capsule.Installable> = [];
