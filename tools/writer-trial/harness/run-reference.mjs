import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFlight } from "../flight-check.mjs";
import { flightEnvironment, pinFlightImages } from "../flight-network.mjs";
import { jevAsk } from "../broker.mjs";
import { judgeFile, judgedFiles } from "../folder.mjs";
import { gateFiles, flightGate, machineVerdict } from "../gate.mjs";
import { sourceHashOf } from "../answers.mjs";
import { sha256File, freezeTrial, verifyFrozen } from "../suite.mjs";

const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const config = JSON.parse(readFileSync(join(repo, "tools/writer-trial/config.json")));
const images = pinFlightImages(config);
const context = join(
  homedir(),
  ".local/share/tinker-writer-trial",
  `image-${config.flight.image.split(":").at(-1)}`,
);
const scaffold = JSON.parse(readFileSync(join(context, "scaffold.json")));
const reference = join(repo, "tools/flight-trial/reference");
const proof = resolve(process.argv[2] ?? join(repo, "tools/writer-trial/.logs/reference"));
const rounds =
  process.argv[3] && process.argv[3] !== "--once" ? [Number(process.argv[3])] : [1, 2, 3, 4, 5];
const labels = process.argv.includes("--once") ? ["pass-1"] : ["pass-1", "pass-2", "break"];
const plants = {
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
  3: {
    file: "src/backend/bookings.ts",
    from: "if (current.total_amount !== selected.total_amount)",
    to: "if (false)",
    fails: "r3 a changed price is refused before any hold order",
  },
  4: {
    file: "src/backend/payment-signature.ts",
    from: 'return timingSafeEqual(expected, Buffer.from(parts.digest, "hex"))',
    to: "return expected.length === 32",
    fails: "r4 payment waits for a valid signed webhook and syncs across tabs",
  },
  5: {
    file: "src/backend/booking-mail.ts",
    from: "const sent = await send.settle({ rawInput: stored.notification });",
    to: 'const sent = await send.settle({ rawInput: stored.notification });\n    if (sent.status !== "success") raise("RetryNotAvailable", {});',
    fails: "r5 failed mail keeps the booking valid and retry sends once",
  },
};
const results = [];
mkdirSync(proof, { recursive: true });
const frozenInfo = freezeTrial(proof, "flight");
const frozen = join(proof, frozenInfo.dir);
for (const file of ["scaffold.json", "starter.json"]) {
  cpSync(join(context, file), join(frozen, file));
  frozenInfo.files[file] = sha256File(join(frozen, file));
}
symlinkSync(join(repo, "tools/jev/node_modules"), join(frozen, "jev/node_modules"));
writeFileSync(
  join(proof, "manifest.json"),
  JSON.stringify({ images, frozen: frozenInfo }, null, 2) + "\n",
);
const jevDir = join(frozen, "jev");
const judges = JSON.parse(readFileSync(join(frozen, "config.json"))).judges;
const starter = JSON.parse(readFileSync(join(frozen, "starter.json")));
const ask = await jevAsk(jevDir);
const answers = new Map();

/** Use the same frozen judges and exact starter trust rule as review.mjs. */
async function judgeProject(project) {
  const reports = [];
  for (const file of judgedFiles(project)) {
    const source = readFileSync(join(project, file), "utf8");
    if (starter[file] === sha256File(join(project, file)))
      reports.push({ file, rows: [], plainFindings: [], trustedRegistry: true });
    else {
      const report = await judgeFile(project, file, {
        jevDir,
        judges,
        ask,
        answers,
        suite: "flight",
      });
      reports.push(report);
      if (!report.error) answers.set(`${file}\0${sourceHashOf(source)}`, report);
    }
  }
  return { jevDir, judges, reports, gate: gateFiles(reports) };
}
for (const round of rounds) {
  assert.ok(plants[round], "Choose round 1 to 5");
  const root = join(proof, `round-${round}`);
  const project = join(root, "project");
  mkdirSync(root, { recursive: true });
  cpSync(join(context, "seed"), project, { recursive: true });
  symlinkSync("/home/pwuser/flight-tools/node_modules", join(project, "node_modules"));
  for (const folder of ["src", "scripts", "drizzle"])
    cpSync(join(reference, folder), join(project, folder), {
      recursive: true,
      filter: (path) => !path.endsWith("routeTree.gen.ts"),
    });
  for (const file of [
    "PLAIN.md",
    "vite.config.ts",
    "tsconfig.json",
    "components.json",
    "drizzle.config.ts",
  ])
    cpSync(join(reference, file), join(project, file));
  writeFileSync(
    join(project, ".env"),
    Object.entries(flightEnvironment())
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
  cpSync(join(repo, "tools/writer-trial/flight-services.md"), join(project, "SERVICES.md"));
  const syncTest = join(project, "tests/sync-client.test.ts");
  writeFileSync(
    syncTest,
    readFileSync(syncTest, "utf8").replaceAll("todos: [],", "todos: [], bookings: [],"),
  );
  if (round === 1) {
    const path = join(project, "src/backend/flight-search.ts");
    const source = readFileSync(path, "utf8");
    const anchor = "].map(async ({ supplier, url }) => {";
    assert.equal(source.split(anchor).length - 1, 1, "One supplier-list anchor");
    writeFileSync(path, source.replace(anchor, "].slice(0, 1).map(async ({ supplier, url }) => {"));
  }
  for (const label of labels) {
    const logs = join(root, label);
    mkdirSync(logs);
    if (label === "break") {
      const plant = plants[round];
      const path = join(project, plant.file);
      const source = readFileSync(path, "utf8");
      assert.equal(source.split(plant.from).length - 1, 1, "One planted-break anchor");
      writeFileSync(path, source.replace(plant.from, plant.to));
    }
    execFileSync(
      join(repo, "node_modules/.bin/vp"),
      [
        "fmt",
        join(project, "src/backend/flight-search.ts"),
        syncTest,
        join(project, plants[round].file),
      ],
      { cwd: repo, stdio: "inherit" },
    );
    const archive = join(logs, "source.tar");
    execFileSync("tar", ["-C", project, "-cf", archive, "."]);
    const result = checkFlight({
      archive,
      round,
      image: images.image,
      images,
      scaffold,
      logDir: logs,
      teacherPins: frozenInfo.teacher,
    });
    verifyFrozen(proof, frozenInfo);
    const jev = { gate: flightGate(result) };
    const judged = jev.gate ? jev : await judgeProject(project);
    writeFileSync(join(logs, "jev.json"), JSON.stringify(judged, null, 2) + "\n");
    const jevExit = judged.gate.status === "pass" ? 0 : 1;
    const machine = machineVerdict({
      ownExit: result.ownExit,
      teacherExit: result.teacherExit,
      gate: judged.gate,
    });
    const exit = machine === "machine-pass" ? 0 : 1;
    const row = { round, label, exit, jevExit, machine, ...result, logs };
    writeFileSync(join(logs, "result.json"), JSON.stringify(row, null, 2) + "\n");
    results.push(row);
    writeFileSync(join(proof, "results.json"), JSON.stringify(results, null, 2) + "\n");
    console.log(`ROUND ${round} ${label} EXIT ${exit}; ${logs}`, JSON.stringify(row));
    if (label !== "break") assert.equal(exit, 0, "Full reference gate must pass");
    else {
      assert.equal(result.teacherExit, 1, "Teacher must reject the planted break");
      const output = readFileSync(join(logs, "teacher.log"), "utf8");
      const line = output.split("\n").find((entry) => entry.startsWith("RESULTS_JSON "));
      assert.ok(line, "Teacher results must exist");
      const failed = JSON.parse(line.slice("RESULTS_JSON ".length)).cases.find(
        (entry) => entry.name === plants[round].fails,
      );
      assert.equal(failed?.pass, false, plants[round].fails);
      assert.ok(
        !/Control .*failed|page.goto|Executable|heading/.test(failed.error),
        "Setup failure is not proof",
      );
      console.log(`CANARY-PASS r${round}: ${plants[round].fails}`);
    }
  }
}
console.log(
  process.argv.includes("--once")
    ? "PASS full reference gates once per round"
    : "PASS full reference gates and named planted breaks",
);
