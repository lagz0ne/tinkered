import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { environmentArgs, flightNames, startFlight, stopFlight } from "./flight-network.mjs";

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
export function checkFlight({
  archive,
  round,
  image,
  images,
  scaffold,
  logDir,
  teacherDir = join(here, "teacher/flight"),
}) {
  const prefix = `flight-check-${Date.now().toString(36)}-${process.pid}`;
  const own = [],
    teacher = [],
    seam = [];
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
      ...sandbox,
      ...environmentArgs(),
      image,
    ]);
    state.containers.push(app);
    run(
      ["exec", "-i", app, "timeout", "30", "tar", "-xf", "-", "-C", "/work"],
      readFileSync(archive),
    );
    scaffoldExit = checkScaffold(app, scaffold, seam);
    ownExit = checkOwn(app, own);
    teacherExit = checkTeacher(state, app, round, image, teacher, teacherDir);
    try {
      teacher.push(run(["exec", app, "cat", "/tmp/app.log"]));
    } catch {}
    const generatedRouterHash = run([
      "exec",
      app,
      "node",
      "-e",
      "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('/work/src/routeTree.gen.ts')).digest('hex'))",
    ]).trim();
    return { ownExit, teacherExit, scaffoldExit, generatedRouterHash, images };
  } finally {
    writeFileSync(join(logDir, "own.log"), own.join(""));
    writeFileSync(join(logDir, "teacher.log"), teacher.join(""));
    writeFileSync(join(logDir, "scaffold.log"), seam.join(""));
    stopFlight(state);
  }
}

function checkScaffold(app, scaffold, seam) {
  try {
    const probe = `const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');const expected=JSON.parse(process.argv[1]);const found={};function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('scaffold link '+p);if(e.isDirectory())walk(p);else found[p.slice('/work/'.length)]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}}if(fs.realpathSync('/work/src/scaffold')!=='/work/src/scaffold')throw Error('scaffold link');walk('/work/src/scaffold');if(JSON.stringify(Object.entries(found).sort())!==JSON.stringify(Object.entries(expected).sort()))throw Error('src/scaffold changed');console.log('PASS src/scaffold exact bytes');`;
    seam.push(run(["exec", app, "node", "-e", probe, JSON.stringify(scaffold)]));
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

function checkTeacher(state, app, round, image, teacher, teacherDir) {
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
      mailpitUrl: "http://mailpit:8025",
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
    };
    teacher.push(
      run([
        "exec",
        ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
        grader,
        "timeout",
        "280",
        "node",
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
  process.exitCode = result.ownExit || result.teacherExit || result.scaffoldExit;
}
