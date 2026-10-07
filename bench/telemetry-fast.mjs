import { createScope, operation } from "@tinker/core";
import { makeTestClock } from "@tinker/core/testing";
import { httpBackend } from "../packages/start/src/backend/http-backend";
import { env } from "../packages/start/src/env";
import {
  flushTelemetry,
  observer,
  telemetryExport,
} from "../packages/start/src/parts/telemetry/observer";
import { telemetrySide } from "../packages/start/src/parts/telemetry/settings";

/** The study excludes stdout so this probe measures the queue. */
process.stdout.write = () => true;
let sends = 0;
let sentBytes = 0;
const clock = makeTestClock({ now: 1_800_000_000_000 });
const tools = createScope({
  clock,
  extensions: [telemetryExport],
  tags: [
    env({
      VICTORIA_TRACES_URL: "http://s.test/traces",
      VICTORIA_LOGS_URL: "http://s.test/logs",
      OTEL_SERVICE_NAME: "bench",
    }),
    telemetrySide("server"),
    httpBackend(async (_input, init) => {
      sends++;
      sentBytes += Buffer.byteLength(init.body);
      return new Response(null);
    }),
  ],
});
await tools.ready;
const app = createScope({ clock, observe: tools.resolve(observer) });
await app.ready;
const small = operation({ label: "bench.op", run: () => 1 });
let sum = 0;
for (let index = 0; index < 100_000; index++) {
  sum += app.run(small);
  if ((index + 1) % 500 === 0) await tools.run(flushTelemetry);
}
if ((await app.close({ graceful: true })).status !== "success") process.exit(1);
if ((await tools.close({ graceful: true })).status !== "success") process.exit(1);
process.stderr.write(`${JSON.stringify({ sum, sends, sentBytes })}\n`);
