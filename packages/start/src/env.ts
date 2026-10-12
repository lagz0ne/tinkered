import type { Tag } from "@tinker/core";
import { tag } from "@tinker/core";

export declare namespace Env {
  /** The process environment, as the server entry copies it once. */
  type Values = Readonly<Record<string, string | undefined>>;
  /**
   * The server seam's `settings`: it turns env into the typed tags the app's units need
   * (ADR 0113). The units never see env.
   */
  type Read = (env: Values) => Tag.Bindings;
}

/** The process environment, copied once by the server entry; each base part checks its own keys. */
export const env = tag<Env.Values>({ label: "tinker.env" });
