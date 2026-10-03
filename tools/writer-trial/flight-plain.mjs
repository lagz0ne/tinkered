import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

/** Only trusted image files decide whether this check exists. */
export function runPlain(seed, project) {
  const script = JSON.parse(readFileSync(resolve(seed, "package.json"))).scripts?.["check:plain"];
  if (!script) return unavailable("image has no check:plain script");
  const entry = script.match(/(?:^|\s)([^\s]+\.(?:mjs|cjs|js))(?:\s|$)/)?.[1];
  if (entry && spawnSync("test", ["-f", resolve(seed, entry)]).status !== 0)
    return unavailable("image check:plain entry is absent");
  const result = spawnSync("npm", ["run", "check:plain", "--", project], {
    cwd: seed,
    env: { ...process.env, npm_config_cache: "/tmp/npm" },
    encoding: "utf8",
    timeout: 280000,
    maxBuffer: 16e6,
  });
  return plainResult(result, project);
}
function plainResult(result, project) {
  return {
    plainExit: result.status === 0 ? 0 : 1,
    output: `RUN trusted npm run check:plain -- ${project}\n${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}\nEXIT ${result.status ?? 1} check:plain\n`,
  };
}

function unavailable(reason) {
  return {
    plainExit: 1,
    plainUnavailable: true,
    unavailable: `Image check:plain unavailable: ${reason}`,
    unscored: true,
    output: `Unavailable: ${reason}\nEXIT 1 check:plain\n`,
  };
}
if (import.meta.main) console.log(JSON.stringify(runPlain("/home/pwuser/flight-seed", "/work")));
