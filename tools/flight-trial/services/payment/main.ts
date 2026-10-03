import { createScope } from "@tinker/core";
import { z } from "zod";
import { app, webhookUrl, secret, webhookDelayMs } from "./index.ts";
import { port, host, controlToken, stopSignal } from "../http.ts";

/** This process entry owns its root and process signals; resources own the service. */
if (import.meta.main) {
  const settings = z
    .object({
      PORT: z.coerce.number().int().min(0).max(65535),
      HOST: z.string().default("127.0.0.1"),
      CONTROL_TOKEN: z.string().min(1),
      WEBHOOK_URL: z.url().default("http://127.0.0.1:4300/webhooks/stripe"),
      WEBHOOK_SECRET: z.string().min(1).default("flight-local-secret"),
      WEBHOOK_DELAY_MS: z.coerce.number().int().positive().default(20),
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
      webhookUrl(settings.WEBHOOK_URL),
      secret(settings.WEBHOOK_SECRET),
      webhookDelayMs(settings.WEBHOOK_DELAY_MS),
    ],
  });
  await scope.ready;
  const { url } = scope.resolve(app);
  process.stdout.write(`${JSON.stringify({ service: "payment", url, pid: process.pid })}\n`);
  const ended = await scope.closed;
  process.off("SIGINT", halt);
  process.off("SIGTERM", halt);
  if (ended.status !== "success") {
    process.stderr.write(`${JSON.stringify({ closed: ended })}\n`);
    process.exitCode = 1;
  }
}
