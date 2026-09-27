// The writer-trial Jev gate over a repo folder, such as an app.
//
//   node tools/writer-trial/app-gate.mjs <folder> [--json <file>]
//
// It judges the folder's src/ and tests/ .ts(x) files, reading them and never
// running them, with the same gate review.mjs check applies to a trial snapshot:
//
//   - a plain shape finding blocks (writer mode: S17-S19 are on);
//   - a Jev hit blocks when its judge is `proven` in the calibration;
//   - any other Jev hit is advice;
//   - a check that did not run is unavailable, never a pass.
//
// Unlike a trial, it uses the repo's live tools/jev: its current calibration.json
// and question bank, not a trial's frozen copy. HELP below says the rest.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { jevAsk } from "./broker.mjs";
import { gateOf } from "./gate.mjs";
import { exitCodeOf, gateFolder, summaryOf } from "./folder.mjs";

const jevDir = fileURLToPath(new URL("../jev/", import.meta.url));
const configPath = fileURLToPath(new URL("config.json", import.meta.url));
const HELP = `Usage: node tools/writer-trial/app-gate.mjs <folder> [--json <file>]

Runs the writer-trial Jev gate over <folder>/src and <folder>/tests (.ts, .tsx).
Files are read, never run. Plain shape rules run in writer mode (S17-S19 on).
Calibration and question bank: the repo's live tools/jev (calibration.json),
not a trial's frozen copy. Judges: tools/writer-trial/config.json.
A shape finding or a hit on a proven judge blocks; other hits are advice.
Exit 0: nothing blocks. 1: something blocks. 2: a check is unavailable.
--json <file> writes the full report; the summary goes to stdout.
`;
const [folderArg, ...rest] = process.argv.slice(2);
if (folderArg === "--help") {
  process.stdout.write(HELP);
  process.exit(0);
}
const jsonAt = rest.indexOf("--json");
const jsonPath = jsonAt === -1 ? null : rest[jsonAt + 1];
// A bad call exits 2 like any gate that could not run: 1 means "blocks".
const isFolder = Boolean(folderArg) && existsSync(folderArg) && statSync(folderArg).isDirectory();
if (!isFolder || (jsonAt !== -1 && !jsonPath)) {
  process.stderr.write(HELP);
  process.exit(2);
}

const folder = resolve(folderArg);
const { judges } = JSON.parse(readFileSync(configPath, "utf8"));
let result;
try {
  result = await gateFolder(folder, { jevDir, judges, ask: await jevAsk(jevDir) });
} catch (error) {
  result = { files: [], reports: [], gate: gateOf({ file: null, error: error.message }) };
}
const exit = exitCodeOf(result.gate);
const report = { folder, jevDir, judges, ...result, exit };
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(summaryOf(result.gate));
process.exitCode = exit;
