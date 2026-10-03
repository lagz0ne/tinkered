import { z } from "zod";
import { startPayment, startSupplier } from "../dist/index.mjs";

/** This entry owns OS signals; each child has its own Core root and HTTP listener. */
async function main() {
  const kind = z.enum(["supplier-a", "supplier-b", "supplier-c", "payment"]).parse(process.argv[2]);
  const settings = z
    .object({
      PORT: z.coerce.number().int().min(0).max(65535),
      HOST: z.string().default("127.0.0.1"),
      CONTROL_TOKEN: z.string().min(1),
      WEBHOOK_URL: z.url().default("http://127.0.0.1:4300/webhooks/stripe"),
      WEBHOOK_SECRET: z.string().min(1).default("flight-local-secret"),
      HOLD_MS: z.coerce.number().int().positive().default(1000),
      WEBHOOK_DELAY_MS: z.coerce.number().int().positive().default(20),
    })
    .parse(process.env);
  const stop = new AbortController();
  const halt = () => stop.abort();
  process.once("SIGINT", halt);
  process.once("SIGTERM", halt);
  const options = {
    port: settings.PORT,
    host: settings.HOST,
    controlToken: settings.CONTROL_TOKEN,
    signal: stop.signal,
  };
  const service =
    kind === "payment"
      ? await startPayment({
          ...options,
          webhookUrl: settings.WEBHOOK_URL,
          secret: settings.WEBHOOK_SECRET,
          webhookDelayMs: settings.WEBHOOK_DELAY_MS,
        })
      : await startSupplier({ ...options, supplier: kind, holdMs: settings.HOLD_MS });
  process.stdout.write(
    `${JSON.stringify({ service: kind, url: service.url, pid: process.pid })}\n`,
  );
  const ended = await service.closed;
  process.off("SIGINT", halt);
  process.off("SIGTERM", halt);
  if (ended.status !== "success") {
    process.stderr.write(`${JSON.stringify({ service: kind, closed: ended })}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
