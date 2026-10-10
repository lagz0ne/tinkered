// The sync probe, scenario `sync1k` of bench/core-probe.mjs: 1,000 open streams of one account,
// then S saved changes. Each save wakes every stream, and each stream sends its frame. The probe
// prints the mean ns per save and the frame bytes per save; the tree is the one CORE_DIST points into
// (ab.sh gives each side its own build), so A and B each run their own Start sync source.
import { register } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const coreDist = process.env.CORE_DIST;
const root = coreDist ? resolve(dirname(coreDist), "../../..") : process.cwd();
register("./sync-hooks.mjs", { parentURL: import.meta.url, data: { root } });

const { createScope } = await import(
  coreDist ? pathToFileURL(resolve(coreDist)).href : "../packages/core/dist/index.mjs"
);

const sync = (file) => import(pathToFileURL(join(root, "packages/start/src", file)).href);
const { openSync } = await sync("parts/sync/stream.server.ts");
const { backendStop, requestStop } = await sync("backend/lifetime.ts");
const { requestHeaders } = await sync("backend/headers.server.ts");
const { database } = await import(pathToFileURL(join(root, "bench/sync-app.server.mjs")).href);
const { sql } = await import("drizzle-orm");

const STREAMS = 1000;
const WARM_SAVES = 3;
const SAVES = Number(process.env.SAVES ?? 10);
const decoder = new TextDecoder();

const stop = new AbortController();
const scope = createScope({ tags: [backendStop(stop.signal), requestStop(stop.signal)] });
const db = await scope.resolve(database);

const sessions = Array.from({ length: STREAMS }, () =>
  scope.createSession({ tags: requestHeaders(new Headers({ "x-account": "ada" })) }),
);

const readers = await Promise.all(
  sessions.map(async (session) =>
    (
      await session.run(openSync, {
        input: { cursor: { public: 0, private: { accountId: "ada", revision: 0 } } },
      })
    ).getReader(),
  ),
);

await Promise.all(readers.map((reader) => reader.read()));

let revision = 0;

/** One save: every stream's pending read gets its frame. Returns the frame bytes it sent. */
async function save() {
  revision += 1;
  const held = Promise.all(readers.map((reader) => reader.read()));
  await db.execute(
    sql`insert into sync_event (stream, revision, "executionId", payload)
        values ('ada', ${revision}, ${`bench-${revision}`}, ${JSON.stringify({ kind: "change", change: revision })}::jsonb)`,
  );
  let bytes = 0;
  for (const { value } of await held) {
    if (!decoder.decode(value).startsWith("event: changes"))
      throw new Error("expected a changes frame");
    bytes += value.byteLength;
  }
  return bytes;
}

for (let index = 0; index < WARM_SAVES; index += 1) await save();
const started = performance.now();
let bytes = 0;
for (let index = 0; index < SAVES; index += 1) bytes += await save();
const ns = ((performance.now() - started) * 1e6) / SAVES;

for (const reader of readers) await reader.cancel();
for (const session of sessions) await session.close({ graceful: true });
await scope.close({ graceful: true });

console.log(
  `METRIC sync1k mode=batch sync1k_ns=${ns.toFixed(1)} sync1k_b=${Math.round(bytes / SAVES)}`,
);
