import { operation } from "@tinkered/core";

import { version } from "#package.json";

/** This package's version, read from its package.json when it is built. */
export const baseVersion = version;

export const health = operation({
  label: "tinker.health",
  run: () => ({ ok: true, base: baseVersion }),
});
