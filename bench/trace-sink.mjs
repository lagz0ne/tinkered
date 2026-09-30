/** Run only through benchctl from a clean tree. The timed part is the public
 * export callback: retain one finished span in the bounded queue. HTTP and
 * scope setup/close are outside that part; the receiver checks delivery. */
import { once } from "node:events";
import { createServer } from "node:http";
import { createScope, makeTestClock, operation } from "../packages/core/dist/index.mjs";
import { traceSink } from "../packages/stack/dist/index.mjs";

let received = 0;
const collector = createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    const packet = JSON.parse(body);
    received += packet.resourceSpans[0].scopeSpans[0].spans.length;
    response.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
}).listen(0, "127.0.0.1");
await once(collector, "listening");
const endpoint = `http://127.0.0.1:${collector.address().port}`;
const samples = [];
const count = 1024;
const op = operation({ label: "probe", run: () => "ok" });
try {
  for (let round = 0; round < 71; round++) {
    const sink = traceSink({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, OTEL_SERVICE_NAME: "trace-bench" },
      write: () => {},
    });
    const scope = createScope({
      extensions: sink.extension,
      observe: sink.observe,
      clock: makeTestClock(),
    });
    await scope.ready;
    const spans = [];
    const source = createScope({ observe: { export: (span) => spans.push(span) } });
    for (let i = 0; i < count; i++) source.run(op);
    await source.close();
    const start = process.hrtime.bigint();
    for (const span of spans) sink.observe.export(span);
    const ns = Number(process.hrtime.bigint() - start) / count;
    if (round >= 10) samples.push(ns);
    await scope.close({ graceful: true });
  }
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      scenario: "retain finished span in OTLP queue",
      count,
      samples: samples.length,
      minNs: samples[0],
      medianNs: samples[30],
      p95Ns: samples[57],
      received,
    }),
  );
  if (received !== 71 * count) process.exitCode = 1;
} finally {
  collector.closeAllConnections();
  await new Promise((resolve) => collector.close(resolve));
}
