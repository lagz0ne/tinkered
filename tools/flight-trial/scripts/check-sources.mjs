import { readFile, readdir } from "node:fs/promises";
import { encodeSource, fetchSources, hash, selectSource } from "./source.mjs";

const data = new URL("../data/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", data), "utf8"));
const files = await fetchSources(manifest.commit);
for (const [name, bytes] of Object.entries(files)) {
  if (hash(bytes) !== manifest.sources[name].sha256)
    throw new Error(`Source hash differs: ${name}`);
  console.log(`PASS ${name} ${hash(bytes)} (${bytes.length} bytes)`);
}
const subset = await readFile(new URL("source.json", data));
if (
  hash(subset) !== manifest.subset.sha256 ||
  encodeSource(selectSource(files)) !== encodeSource(JSON.parse(subset.toString()))
) {
  throw new Error("Source subset differs from the pinned data");
}
let size = 0;
for (const name of await readdir(data)) size += (await readFile(new URL(name, data))).length;
if (size >= 1_000_000) throw new Error(`Committed data is too large: ${size}`);
console.log(`PASS subset ${hash(subset)} (${subset.length} bytes)`);
console.log(`PASS data total ${size} bytes (< 1000000)`);
