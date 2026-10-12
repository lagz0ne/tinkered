import { resource, tag } from "@tinker/core";

import { telemetryEnv } from "#tinker/telemetry-env";

import { readPartEnv } from "../../../lib/part-env.mjs";
import type { Env } from "../../env";
import { raise } from "../../errors";
import type { Telemetry } from "./records";

/** Where this root's records come from; each entry binds its own side. */
export const telemetrySide = tag<Telemetry.Side>({ label: "telemetry.side" });

/**
 * The service name and storage URLs (ADR 0113). The server entry fills it from env; a tab
 * keeps the defaults, since it sends to the base's ingest route.
 */
export const telemetryConfig = tag<Telemetry.Config>({
  label: "telemetry.config",
  default: {
    service: telemetryEnv.OTEL_SERVICE_NAME.default,
    traces: telemetryEnv.VICTORIA_TRACES_URL.default,
    logs: telemetryEnv.VICTORIA_LOGS_URL.default,
  },
});

/**
 * Fills {@link telemetryConfig} from the telemetry part's env keys, checked once at start.
 * @param env - From the server entry's copy of process.env; why: the keys to check.
 */
export function readTelemetryConfig(env: Env.Values) {
  const { values, refused } = readPartEnv(telemetryEnv, env);
  if (refused.length > 0) raise("BadSettings", { part: "telemetry", keys: refused });

  return telemetryConfig({
    service: values.OTEL_SERVICE_NAME,
    traces: values.VICTORIA_TRACES_URL,
    logs: values.VICTORIA_LOGS_URL,
  });
}

/** This side's settings. The browser has no storage URLs: it sends to the ingest route. */
export const telemetrySettings = resource({
  label: "telemetry.settings",
  depends: { config: telemetryConfig, side: telemetrySide },
  factory: ({ config, side }): Telemetry.Settings => {
    if (side === "browser") return { side, service: config.service };
    return { side, ...config };
  },
});
