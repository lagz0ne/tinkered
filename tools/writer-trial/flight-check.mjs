import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  environmentArgs,
  flightEnvironment,
  flightNames,
  startFlight,
  stopFlight,
} from "./flight-network.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const run = (args, input) =>
  execFileSync("docker", args, { input, encoding: "utf8", timeout: 300000, maxBuffer: 16e6 });
const sandbox = [
  "--read-only",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges",
  "--memory",
  "2g",
  "--cpus",
  "2",
  "--pids-limit",
  "256",
  "--shm-size",
  "512m",
  "--tmpfs",
  "/tmp:rw,nosuid,size=512m",
  "--tmpfs",
  "/work:rw,nosuid,size=1g,uid=1001,gid=1001",
  "--user",
  "pwuser",
  "--init",
];

/** Submitted files stay in an app container; teacher code and credentials stay in a separate one. */
export function checkFlight({ archive, round, image, images, scaffold, logDir }) {
  const prefix = `flight-check-${Date.now().toString(36)}-${process.pid}`;
  const own = [],
    teacher = [],
    seam = [],
    plain = [];
  const state = startFlight(prefix, images);
  let ownExit = 0,
    teacherExit = 0,
    scaffoldExit = 0;
  const app = `${prefix}-app`;
  try {
    run([
      "run",
      "-d",
      "--name",
      app,
      "--network",
      state.network,
      "--network-alias",
      "app",
      "--network-alias",
      "flight-app",
      "--dns",
      "127.0.0.1",
      ...sandbox,
      ...environmentArgs(),
      image,
    ]);
    state.containers.push(app);
    run(
      ["exec", "-i", app, "timeout", "30", "tar", "-xf", "-", "-C", "/work"],
      readFileSync(archive),
    );
    const resetExit = resetRouter(app, own);
    scaffoldExit = checkScaffold(app, scaffold, seam);
    const plainResult = checkFlightPlain(app, plain);
    ownExit = checkOwn(app, own) || resetExit;
    teacherExit = checkTeacher(state, app, round, image, teacher);
    try {
      teacher.push(run(["exec", app, "cat", "/tmp/app.log"]));
    } catch {}
    const router = checkRouter(app, own);
    ownExit = Math.max(ownExit, router.exit);
    const generatedRouterHash = router.hash;
    return { ownExit, teacherExit, scaffoldExit, ...plainResult, generatedRouterHash, images };
  } finally {
    writeFileSync(join(logDir, "own.log"), own.join(""));
    writeFileSync(join(logDir, "teacher.log"), teacher.join(""));
    writeFileSync(join(logDir, "scaffold.log"), seam.join(""));
    writeFileSync(join(logDir, "plain.log"), plain.join(""));
    stopFlight(state);
  }
}

function resetRouter(app, own) {
  try {
    run(
      ["exec", "-i", app, "sh", "-c", "cat > /tmp/flight-router.mjs"],
      readFileSync(join(here, "flight-router.mjs")),
    );
    own.push(run(["exec", app, "node", "/tmp/flight-router.mjs", "reset"]));
    return 0;
  } catch (error) {
    own.push(`${error.stdout ?? ""}${error.stderr ?? ""}\nEXIT 1 router reset\n`);
    return 1;
  }
}

function checkRouter(app, own) {
  try {
    run(
      ["exec", "-i", app, "sh", "-c", "cat > /tmp/flight-router.mjs"],
      readFileSync(join(here, "flight-router.mjs")),
    );
    const hash = run(["exec", app, "node", "/tmp/flight-router.mjs", "hash"]).trim();
    own.push("EXIT 0 fresh generated router\n");
    return { hash, exit: 0 };
  } catch (error) {
    own.push(`${error.stdout ?? ""}${error.stderr ?? ""}\nEXIT 1 fresh generated router\n`);
    return { hash: null, exit: 1 };
  }
}

function checkScaffold(app, scaffold, seam) {
  try {
    run(
      ["exec", "-i", app, "sh", "-c", "cat > /tmp/flight-scaffold.mjs"],
      readFileSync(join(here, "flight-scaffold.mjs")),
    );
    seam.push(run(["exec", app, "node", "/tmp/flight-scaffold.mjs", JSON.stringify(scaffold)]));
    seam.push(
      run([
        "exec",
        app,
        "node",
        "/home/pwuser/flight-seed/scripts/check-seam.mjs",
        "/work/src/scaffold",
      ]),
    );
    seam.push("EXIT 0 scaffold\n");
  } catch (error) {
    seam.push(`${error.stdout ?? ""}${error.stderr ?? ""}\nEXIT 1 scaffold\n`);
    return 1;
  }
  return 0;
}

/** Run the image's trusted script on the submitted project, never a writer's replacement. */
export function checkFlightPlain(app, log) {
  try {
    run(
      ["exec", "-i", app, "sh", "-c", "cat > /tmp/flight-plain.mjs"],
      readFileSync(join(here, "flight-plain.mjs")),
    );
    const { output, ...result } = JSON.parse(run(["exec", app, "node", "/tmp/flight-plain.mjs"]));
    log.push(output);
    return result;
  } catch (error) {
    log.push(`${error.stdout ?? ""}${error.stderr ?? ""}\nEXIT ${error.status ?? 1} check:plain\n`);
    return { plainExit: 1 };
  }
}

function checkOwn(app, own) {
  let ownExit = 0;
  // The Start router emits routeTree.gen.ts on its first build.
  for (const script of ["build", "check", "test", "build"]) {
    try {
      own.push(
        `RUN npm run ${script}\n`,
        run(["exec", app, "timeout", "280", "npm", "run", script]),
        `EXIT 0 ${script}\n`,
      );
    } catch (error) {
      ownExit = 1;
      own.push(`${error.stdout ?? ""}${error.stderr ?? ""}\nEXIT ${error.status ?? 1} ${script}\n`);
    }
  }
  return ownExit;
}

function checkTeacher(state, app, round, image, teacher) {
  const teacherDir = join(here, "teacher/flight");
  let teacherExit = 0;
  try {
    run(["exec", "-d", app, "sh", "-c", "npm run start > /tmp/app.log 2>&1"]);
    const grader = `${state.prefix}-teacher`;
    run(["create", "--name", grader, "--network", state.controlNetwork, ...sandbox, image]);
    state.containers.push(grader);
    run(["network", "connect", state.network, grader]);
    run(["start", grader]);
    run([
      "exec",
      grader,
      "ln",
      "-s",
      "/home/pwuser/flight-tools/node_modules",
      "/work/node_modules",
    ]);
    const settings = {
      round,
      appUrl: "http://flight-app:4318",
      token: state.token,
      controlUrls: Object.fromEntries(
        flightNames.map((name) => [name, `http://control-${name}:4310`]),
      ),
      serviceUrls: Object.fromEntries(
        flightNames.map((name, i) => [name, `http://${name}:${4311 + i}`]),
      ),
      mailpitUrl: "http://control-mailpit:8025",
    };
    run([
      "exec",
      grader,
      "node",
      "--input-type=module",
      "-e",
      "const end=Date.now()+60000;let ready=false;while(Date.now()<end){try{const r=await fetch('http://app:4318');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error('app not ready');",
    ]);
    if (
      !existsSync(join(teacherDir, "check.mjs")) ||
      !existsSync(join(teacherDir, `round-${round}.mjs`))
    )
      throw new Error(`Teacher round ${round} unavailable: ${teacherDir}`);
    copyTeacher(grader, teacherDir);
    const env = {
      FLIGHT_CHECK_SETTINGS: JSON.stringify(settings),
      APP_URL: settings.appUrl,
      CONTROL_TOKEN: state.token,
      SUPPLIER_A_URL: settings.controlUrls["supplier-a"],
      SUPPLIER_B_URL: settings.controlUrls["supplier-b"],
      SUPPLIER_C_URL: settings.controlUrls["supplier-c"],
      PAYMENT_URL: settings.controlUrls.payment,
      MAILPIT_URL: settings.mailpitUrl,
      WEBHOOK_SECRET: flightEnvironment().WEBHOOK_SECRET,
    };
    run(
      ["exec", "-i", grader, "sh", "-c", "cat > /work/grader.env"],
      Object.entries(env)
        .map(([key, value]) => `${key}='${value}'`)
        .join("\n") + "\n",
    );
    teacher.push(
      run([
        "exec",
        grader,
        "timeout",
        "280",
        "node",
        "--env-file=/work/grader.env",
        "/work/flight/check.mjs",
        String(round),
      ]),
      "EXIT 0 teacher\n",
    );
  } catch (error) {
    teacherExit = 1;
    teacher.push(`${error.stdout ?? ""}${error.stderr ?? ""}\nEXIT ${error.status ?? 1} teacher\n`);
  }
  return teacherExit;
}

function copyTeacher(container, path) {
  const bytes = execFileSync("tar", ["-C", dirname(path), "-cf", "-", basename(path)], {
    maxBuffer: 16e6,
  });
  run(["exec", "-i", container, "tar", "-xf", "-", "-C", "/work"], bytes);
}

if (import.meta.main) {
  const [archive, round, image, configFile, scaffoldFile, logDir] = process.argv.slice(2);
  if (!logDir)
    throw new Error(
      "flight-check <archive> <round> <image> <images.json> <scaffold.json> <log-dir>",
    );
  const result = checkFlight({
    archive,
    round: Number(round),
    image,
    images: JSON.parse(readFileSync(configFile)),
    scaffold: JSON.parse(readFileSync(scaffoldFile)),
    logDir,
  });
  console.log(JSON.stringify(result));
  process.exitCode =
    result.ownExit || result.teacherExit || result.scaffoldExit || result.plainExit;
}
