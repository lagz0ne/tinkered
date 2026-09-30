import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const mode = process.argv.at(2);
if (mode !== "restart" && mode !== "reload") throw new Error("use restart or reload");
const edits = 5;

async function readFreePort() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  return port;
}

function start(root, port) {
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/dev.ts"], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      DATA_PATH: join(root, "data/issues"),
      PORT: String(port),
      DRAFT_HELPER: "0",
      XDG_CACHE_HOME: resolve(".bench/cache"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const events = new EventEmitter();
  const exited = once(child, "exit");
  let errorText = "";
  child.stderr.setEncoding("utf8").on("data", (text) => {
    errorText += text;
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    errorText += `${line}\n`;
    const event = JSON.parse(line);
    if (event.kind === "ready") events.emit("ready");
    if (event.kind === "error") events.emit("error", new Error(JSON.stringify(event)));
  });
  const ready = () =>
    Promise.race([
      once(events, "ready"),
      exited.then(([code, signal]) => {
        throw new Error(`early exit ${code}/${signal}: ${errorText}`);
      }),
    ]);
  return { child, exited, ready, output: () => errorText };
}

async function stop(host) {
  host.child.kill("SIGTERM");
  const [code, signal] = await host.exited;
  if (code !== 0 || signal !== null) {
    throw new Error(`stop failed: ${code}/${signal}: ${host.output()}`);
  }
}

async function run() {
  const app = resolve("apps/issue-tracker");
  await mkdir(".bench", { recursive: true });
  const directory = await mkdtemp(resolve(".bench/dev-cycle-"));
  for (const name of ["src", "drizzle", "index.html", "vite.config.ts", "package.json"]) {
    await cp(join(app, name), join(directory, name), { recursive: true });
  }
  await symlink(join(app, "node_modules"), join(directory, "node_modules"));
  const port = await readFreePort();
  const entry = join(directory, "src/server/main.ts");
  const source = await readFile(entry, "utf8");
  let host = start(directory, port);
  try {
    await host.ready();
    for (let edit = 1; edit <= edits; edit++) {
      if (mode === "restart") {
        await stop(host);
        await writeFile(entry, `${source}\nexport const edit = ${edit};\n`);
        host = start(directory, port);
        await host.ready();
      } else {
        const changed = host.ready();
        await writeFile(entry, `${source}\nexport const edit = ${edit};\n`);
        await changed;
      }
      const response = await fetch(`http://127.0.0.1:${port}/api/issues`);
      if (response.status !== 200) throw new Error(`request failed: ${response.status}`);
      await response.arrayBuffer();
    }
  } finally {
    if (host.child.exitCode === null && host.child.signalCode === null) await stop(host);
    await rm(directory, { recursive: true, force: true });
  }
}

await run();
