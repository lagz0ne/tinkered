import { capsule, tag } from "@tinker/core";
import type { Capsule, Many } from "@tinker/core";

import { readPartEnv } from "../../../lib/part-env.mjs";
import basePackage from "../../../package.json" with { type: "json" };
import type { Env } from "../../env";
import { raise } from "../../errors";

export declare namespace Auth {
  /** What the app's `auth` resource builds on: the public origin and the signing secret. */
  type Settings = { origin: string; secret: string };
  /**
   * What the auth part gives the server entry (ADR 0106): the capsules for the app root, filled
   * from env (ADR 0113).
   */
  type ServerPart = {
    readonly capsules: (env: Env.Values) => Many<Capsule.Installable>;
  };
}

/** What auth needs; the server entry fills it from env, a test fills it by hand (ADR 0113). */
export const authSettings = tag<Auth.Settings>({ label: "auth.settings" });

/** On the app root: its one config key binds {@link authSettings}, so the root does not start
 * without them (`MissingConfig`). */
export const authStartup = capsule({ label: "auth", config: { settings: authSettings } });

/**
 * Fills {@link authStartup} from the auth part's env keys, checked once at start. Neither has
 * a default: a secret must never fall back, and the origin is where the app is served.
 * @param env - From the server entry's copy of process.env; why: the keys to check.
 */
export function readAuthSettings(env: Env.Values) {
  const { values, refused } = readPartEnv(basePackage.tinker.parts.auth.env, env);
  if (refused.length > 0) raise("BadSettings", { part: "auth", keys: refused });

  return authStartup({ settings: { origin: values.PUBLIC_ORIGIN, secret: values.AUTH_SECRET } });
}
