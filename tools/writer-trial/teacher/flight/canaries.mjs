import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const round = Number(process.argv[2]);
const root = fileURLToPath(new URL("../../../flight-trial/reference/", import.meta.url));
const logs = `${root}.logs`;
await mkdir(logs, { recursive: true });
const checks = {
  1: {
    file: "src/frontend/Flights.tsx",
    from: "{row.total_amount} USD",
    to: "0.00 USD",
    fails: "r1 public search shows real fares and asks each active supplier once",
  },
  2: {
    file: "src/frontend/flights.ts",
    from: "merged.set(row.flight_id, row)",
    to: "merged.set(row.id, row)",
    fails: "r2 a cheaper late fare merges and a failed supplier keeps good rows",
  },
};
assert.ok(checks[round], "Choose a ready round");
async function check(label) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("check.mjs", import.meta.url)), String(round)],
    {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const code = await new Promise((done) => child.once("exit", done));
  const log = `${logs}/r${round}-${label}.log`;
  await writeFile(log, output);
  const line = output.split("\n").find((entry) => entry.startsWith("RESULTS_JSON "));
  assert.ok(line, `No check results; read ${log}`);
  const results = JSON.parse(line.slice("RESULTS_JSON ".length));
  console.log(`${label}: exit ${code}; ${log}`);
  return { code, cases: results.cases };
}
for (const label of ["pass-1", "pass-2"])
  assert.equal((await check(label)).code, 0, "Reference must pass twice");
const planted = checks[round];
const path = `${root}${planted.file}`;
const before = await readFile(path, "utf8");
assert.equal(
  before.split(planted.from).length - 1,
  1,
  "The planted break must have one exact anchor",
);
try {
  await writeFile(path, before.replace(planted.from, planted.to));
  const result = await check("break");
  assert.equal(result.code, 1, "The planted break must fail");
  const caught = result.cases.find((entry) => entry.name === planted.fails);
  assert.equal(caught?.pass, false, `The planted break must fail ${planted.fails}`);
  assert.ok(
    !/Control .*failed|page.goto|Executable|heading/.test(caught.error),
    "A setup failure is not proof",
  );
  console.log(`CANARY-PASS r${round}: ${planted.fails}`);
} finally {
  await writeFile(path, before);
}
