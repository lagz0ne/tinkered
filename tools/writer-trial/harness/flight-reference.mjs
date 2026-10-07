import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles } from "../suite.mjs";

/** Port the fixed answer at proof time; its old copied scaffold stays a historical fixture. */
export function placeFlightReference(reference, seed, project, round) {
  cpSync(seed, project, { recursive: true });
  const excluded = new Set([
    "src/client.tsx",
    "src/server.ts",
    "src/start.ts",
    "src/router.tsx",
    "src/routes/__root.tsx",
    "src/routes/api.auth.$.ts",
    "src/routes/api.sync.ts",
    "src/routes/api.telemetry.ts",
    "src/backend/auth.ts",
    "src/backend/database.ts",
    "src/backend/mail.ts",
    "src/transport/routes.server.ts",
  ]);
  for (const file of listFiles(reference)) {
    if (
      !/^(src|tests|drizzle)\//.test(file) ||
      file.startsWith("src/scaffold/") ||
      file.endsWith("routeTree.gen.ts") ||
      excluded.has(file)
    )
      continue;
    cpSync(join(reference, file), join(project, file), { recursive: true });
    if (!/\.tsx?$/.test(file)) continue;
    const source = portSource(readFileSync(join(project, file), "utf8"), file, round);
    writeFileSync(join(project, file), source);
  }
  writeFileSync(
    join(project, "src/lib/extensions.server.ts"),
    'import { databaseSetup } from "../backend/database.ts";\nexport const extensions = [databaseSetup];\n',
  );
  const config = readFileSync(join(seed, "vitest.config.ts"), "utf8").replace(
    "testTimeout: 30000,",
    'testTimeout: 30000,\n    include: ["tests/**/*.test.ts", "tests/**/*.proof.ts"],',
  );
  writeFileSync(join(project, "vitest.config.ts"), config);
}

function portSource(source, file, round) {
  source = source.replace(
    /"(?:\.\.\/|\.\/)scaffold\/(?:backend\/[^"]+|start\.ts)"/g,
    '"@tinker/start/server"',
  );
  source = source.replace(/"(?:\.\.\/|\.\/)scaffold\/(?:sync\.ts|errors\.ts)"/g, '"@tinker/start"');
  source = source.replace(/"(?:\.\.\/|\.\/)scaffold\/frontend\/[^"]+"/g, '"@tinker/start/client"');
  source = source.replaceAll('"@tinker-start-scaffold/transport"', '"@tinker/start/testing"');
  if (file === "src/lib/tinker.ts") source += "\nexport const extensions = [];\n";
  if (file === "src/lib/tinker.server.ts")
    source += '\nexport { extensions } from "./extensions.server.ts";\n';
  if (file === "src/errors.ts")
    source = source.replace(
      "    NotificationFailed:",
      "    BadSettings: { part: string; keys: string[] };\n    NotificationFailed:",
    );
  if (file === "tests/sync-client.test.ts")
    source = source.replaceAll("todos: [],", "todos: [], bookings: [],");
  if (round === 1 && file === "src/backend/flight-search.ts")
    source = source.replace(
      "].map(async ({ supplier, url }) => {",
      "].slice(0, 1).map(async ({ supplier, url }) => {",
    );
  return source;
}

/** Prepare and list the port with the same installed packages as the grader, offline. */
export function prepareFlightReference(project, image) {
  const container = `flight-reference-${process.pid}-${Date.now().toString(36)}`;
  const run = (args) => execFileSync("docker", args, { encoding: "utf8", timeout: 120000 });
  try {
    run([
      "run",
      "-d",
      "--name",
      container,
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,nosuid,size=512m",
      "--tmpfs",
      "/work:rw,nosuid,size=1g,uid=1001,gid=1001",
      image,
    ]);
    run(["exec", container, "sh", "-c", "cp -R /home/pwuser/flight-seed/. /work/"]);
    run(["cp", `${project}/.`, `${container}:/work/`]);
    run(["exec", container, "tinker", "prepare"]);
    run(["exec", container, "vp", "fmt"]);
    run(["exec", container, "sh", "-c", "node scripts/check-plain.mjs --list > PLAIN.md"]);
    run(["cp", `${container}:/work/.`, project]);
  } finally {
    run(["rm", "-f", container]);
  }
}
