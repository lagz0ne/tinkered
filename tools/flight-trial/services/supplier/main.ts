import { createScope } from "@tinker/core";
import { z } from "zod";
import { app, supplierId, holdMs } from "./index.ts";
import { port, host, controlToken, stopSignal } from "../http.ts";

/** This process entry owns its root and process signals; resources own the service. */
if (import.meta.main) {
  const supplier = z.enum(["supplier-a", "supplier-b", "supplier-c"]).parse(process.argv.at(2));
  const settings = z
    .object({
      PORT: z.coerce.number().int().min(0).max(65535),
      HOST: z.string().default("127.0.0.1"),
      CONTROL_TOKEN: z.string().min(1),
      HOLD_MS: z.coerce.number().int().positive().default(1000),
    })
    .parse(process.env);
  const stop = new AbortController();
  const halt = () => stop.abort();
  process.once("SIGINT", halt);
  process.once("SIGTERM", halt);
  const scope = createScope({
    signal: stop.signal,
    extensions: app,
    tags: [
      port(settings.PORT),
      host(settings.HOST),
      controlToken(settings.CONTROL_TOKEN),
      stopSignal(stop.signal),
      supplierId(supplier),
      holdMs(settings.HOLD_MS),
    ],
  });
  await scope.ready;
  const { url } = scope.resolve(app);
  process.stdout.write(`${JSON.stringify({ service: supplier, url, pid: process.pid })}\n`);
  const ended = await scope.closed;
  process.off("SIGINT", halt);
  process.off("SIGTERM", halt);
  if (ended.status !== "success") {
    process.stderr.write(`${JSON.stringify({ closed: ended })}\n`);
    process.exitCode = 1;
  }
}
