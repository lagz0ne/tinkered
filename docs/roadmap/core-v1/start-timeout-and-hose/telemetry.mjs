import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { createScope, extension, namespace, operation, resource } = await import(
  pathToFileURL(resolve(process.argv[2])).href
);
const mode = process.argv[3];
const spans = [];
const quiet = namespace({ observe: false });
const observer = resource({
  label: "observer",
  target: "namespace",
  factory: () => ({ export: (span) => spans.push(span) }),
});
const telemetry = extension({
  label: "telemetry",
  hooks: {
    start(event) {
      event.tap(event.resolve(observer, { ns: quiet }));
      return event.next();
    },
  },
});
const scope = createScope(
  mode === "before"
    ? { observe: { export: (span) => spans.push(span) } }
    : { extensions: [telemetry] },
);
const work = operation({ label: "work", run: () => 42 });

await scope.ready;
const value = scope.run(work);
await scope.close({ graceful: true });

assert.equal(value, 42);
assert.deepEqual(
  spans.map((span) => span.name),
  ["work"],
);
assert.equal(spans[0].status, "ok");
console.log(
  JSON.stringify({
    mode,
    wiring: mode === "before" ? "scope observe" : "start tap",
    value,
    spans: spans.map((span) => ({ name: span.name, status: span.status })),
    count: spans.length,
  }),
);
