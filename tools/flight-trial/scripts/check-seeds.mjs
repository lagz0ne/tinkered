import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
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
  hashes.push(hash(bytes));
  console.log(`${name} ${hash(bytes)} (${bytes.length} bytes; ${data.flights.length} flights)`);
}
if (hashes[0] !== hashes[1] || hashes[0] === hashes[2]) throw new Error("Seed replay check failed");
const saved = await readFile(new URL("../data/flights.json.gz", import.meta.url));
if (hash(saved) !== hashes[0]) throw new Error("Saved flights differ from the default seed");
console.log("PASS same seed matches; other seed differs; saved default matches");
