import { writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { generateFlights } from "../dist/index.mjs";
import { hash } from "./source.mjs";

const seed = Number(process.argv[2] ?? 97);
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
  throw new Error("Seed must be a uint32");
const output = process.argv[3] ?? new URL("../data/flights.json.gz", import.meta.url);
const flights = await generateFlights(seed);
const json = Buffer.from(`${JSON.stringify(flights)}\n`);
const bytes = gzipSync(json, { level: 9 });
await writeFile(output, bytes);
console.log(
  JSON.stringify({
    seed,
    sha256: hash(bytes),
    jsonSha256: hash(json),
    bytes: bytes.length,
    jsonBytes: json.length,
    flights: flights.flights.length,
  }),
);
