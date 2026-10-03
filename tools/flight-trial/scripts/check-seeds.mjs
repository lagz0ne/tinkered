import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { generateFlights } from "../dist/index.mjs";
import { hash } from "./source.mjs";

const logs = new URL("../.logs/", import.meta.url);
await mkdir(logs, { recursive: true });
const hashes = [];
for (const [name, seed] of [
  ["seed-97-a", 97],
  ["seed-97-b", 97],
  ["seed-98", 98],
]) {
  const data = await generateFlights(seed);
  const json = Buffer.from(`${JSON.stringify(data)}\n`);
  const bytes = gzipSync(json, { level: 9 });
  await writeFile(new URL(`${name}.json.gz`, logs), bytes);
  hashes.push(hash(json));
  console.log(
    `${name} JSON ${hash(json)}; gzip ${hash(bytes)} (${bytes.length} bytes; ${data.flights.length} flights)`,
  );
}
if (hashes[0] !== hashes[1] || hashes[0] === hashes[2]) throw new Error("Seed replay check failed");
const manifest = JSON.parse(
  await readFile(new URL("../data/manifest.json", import.meta.url), "utf8"),
);
const saved = await readFile(new URL("../data/flights.json.gz", import.meta.url));
const savedHash = hash(gunzipSync(saved));
if (savedHash !== manifest.generated.jsonSha256 || savedHash !== hashes[0]) {
  throw new Error("Saved flight JSON differs from the manifest or the default seed");
}
console.log(
  "PASS same seed JSON matches; other seed differs; saved JSON matches the manifest and fresh default",
);
