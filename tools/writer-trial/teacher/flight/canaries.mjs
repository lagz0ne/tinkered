import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const round = Number(process.argv[2]);
const root = fileURLToPath(new URL("../../../flight-trial/reference/", import.meta.url));
const logs = `${root}.logs`;
await mkdir(logs, { recursive: true });
let server;
const serverOutput = [];
async function build(label) {
  const child = spawn(process.execPath, [`${root}run.mjs`, "build"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const code = await new Promise((done) => child.once("exit", done));
  const path = `${logs}/r${round}-build-${label}.log`;
  await writeFile(path, output);
  console.log(`build ${label}: exit ${code}; ${path}`);
  assert.equal(code, 0, "Reference build must pass");
}
async function start() {
  server = spawn(process.execPath, [`${root}run.mjs`, "start"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverOutput.length = 0;
  server.stdout.on("data", (chunk) => serverOutput.push(String(chunk)));
  server.stderr.on("data", (chunk) => serverOutput.push(String(chunk)));
  const deadline = Date.now() + 30000;
  for (;;) {
    assert.ok(server.exitCode === null, `Reference server exited: ${serverOutput.join("")}`);
    try {
      const response = await fetch(`${process.env.APP_URL}/flights`, {
        signal: AbortSignal.timeout(5000),
      });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch (error) {
      if (!(error instanceof TypeError) && error.name !== "TimeoutError") throw error;
    }
    assert.ok(Date.now() < deadline, "Reference server did not become ready");
  }
}
async function stop(label) {
  if (!server) return;
  const ended = new Promise((done) => server.once("exit", done));
  server.kill("SIGTERM");
  await ended;
  await writeFile(`${logs}/r${round}-server-${label}.log`, serverOutput.join(""));
  server = undefined;
}
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
  4: {
    file: "src/backend/payment-signature.ts",
    from: 'return timingSafeEqual(expected, Buffer.from(parts.digest, "hex"))',
    to: "return true",
    fails: "r4 payment waits for a valid signed webhook and syncs across tabs",
  },
  3: {
    file: "src/backend/bookings.ts",
    from: "if (current.total_amount !== selected.total_amount)",
    to: "if (false)",
    fails: "r3 a changed price is refused before any hold order",
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
const planted = checks[round];
const path = `${root}${planted.file}`;
const before = await readFile(path, "utf8");
assert.equal(
  before.split(planted.from).length - 1,
  1,
  "The planted break must have one exact anchor",
);
try {
  await build("good");
  await start();
  for (const label of ["pass-1", "pass-2"])
    assert.equal((await check(label)).code, 0, "Reference must pass twice");
  await stop("good");
  await writeFile(path, before.replace(planted.from, planted.to));
  await build("break");
  await start();
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
  await stop("break");
  await writeFile(path, before);
  await build("restored");
}
