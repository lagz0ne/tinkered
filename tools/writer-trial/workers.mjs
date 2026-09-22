import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  symlinkSync,
  existsSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "../..");
const home = join(homedir(), ".local/share/tinker-writer-trial");
const config = JSON.parse(readFileSync(join(here, "config.json")));
const [action, name = "readiness"] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Use a short trial name");
const root = join(home, name);
const manifestPath = join(root, "manifest.json");
const run = (bin, args) =>
  execFileSync(bin, args, { encoding: "utf8", timeout: 120000, maxBuffer: 8e6 });
const save = (manifest) => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
if (action === "create") {
  if (existsSync(manifestPath)) throw new Error("Trial already exists; inspect its manifest");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const jevDir = join(root, "jev");
  mkdirSync(jevDir);
  for (const file of ["lib.mjs", "bank.mjs", "extract.mjs", "calibration.json", "package.json"])
    copyFileSync(join(repo, "tools/jev", file), join(jevDir, file));
  symlinkSync(join(repo, "tools/jev/node_modules"), join(jevDir, "node_modules"));
  const manifest = {
    name,
    createdAt: new Date().toISOString(),
    sourceCommit: run("git", ["-C", repo, "rev-parse", "HEAD"]).trim(),
    image: run("docker", ["image", "inspect", config.image, "--format", "{{.Id}}"]).trim(),
    phase: "readiness",
    workers: [],
  };
  save(manifest);
  for (const [index, model] of config.models.entries()) {
    const slug = `${name}-${index + 1}`;
    const dir = join(root, slug);
    const ext = join(dir, ".pi/extensions/trial");
    mkdirSync(ext, { recursive: true });
    writeFileSync(join(dir, ".pi/settings.json"), JSON.stringify({ defaultTools: [] }));
    const container = `writer-trial-${slug}`;
    const volume = `${container}-work`;
    const worker = {
      model,
      dir,
      container,
      volume,
      projectId: null,
      workspaceId: null,
      agentId: null,
      status: "creating",
    };
    manifest.workers.push(worker);
    save(manifest);
    run("docker", ["volume", "create", "--label", `tinker.writer-trial=${name}`, volume]);
    run("docker", [
      "create",
      "--name",
      container,
      "--label",
      `tinker.writer-trial=${name}`,
      "--network",
      "none",
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
      "--mount",
      `type=volume,src=${volume},dst=/work`,
      "--user",
      "pwuser",
      "--init",
      manifest.image,
    ]);
    run("docker", ["start", container]);
    const seed = join(root, "seed");
    mkdirSync(seed, { recursive: true });
    writeFileSync(
      join(seed, "package.json"),
      JSON.stringify(
        {
          name: "room-booking-trial",
          private: true,
          type: "module",
          scripts: {
            check: "tsc --noEmit",
            build: "vite build",
            test: "vitest run",
            dev: "vite --host 127.0.0.1",
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(seed, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            jsx: "react-jsx",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            allowImportingTsExtensions: true,
            types: ["node", "react", "react-dom"],
          },
          include: ["src", "tests"],
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(seed, "index.html"),
      '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
    );
    writeFileSync(
      join(seed, "GUIDELINES.md"),
      "# Worker rules\n\nUse only core and React from Tinker.\nUse core cells for app state and operations for rules.\nReact reads cells and runs actions.\nUse managed errors; validate user input at the boundary.\nUse strict TypeScript; no casts to hide errors or mocks.\nWrite behavior tests. Run check, test, and build.\nAsk Jev about changed source and tests before submitting.\nFix each finding or explain why it stays.\nDo not change supplied checks or their settings.\nDo not read outside examples or other submissions.\nNo app examples or worked code are supplied.\nPublic API declarations are in node_modules/@tinker/{core,react}/dist/index.d.mts.\nReport check commands, results, and remaining issues.\n",
    );
    writeFileSync(
      join(seed, "TASK.md"),
      "# Readiness only\n\nNo scored task has started.\nFollow the teacher's small tool check, then stop.\n",
    );
    writeFileSync(join(seed, ".gitignore"), "node_modules/\ndist/\n.vite/\n");
    run("docker", ["cp", `${seed}/.`, `${container}:/work`]);
    run("docker", ["exec", container, "git", "init", "-q", "/work"]);
    run("docker", ["exec", container, "git", "-C", "/work", "add", "."]);
    run("docker", [
      "exec",
      container,
      "git",
      "-C",
      "/work",
      "-c",
      "user.name=Trial teacher",
      "-c",
      "user.email=trial@local",
      "commit",
      "-qm",
      "Blank starter; no example code",
    ]);
    for (const file of ["extension.mjs", "broker.mjs"])
      copyFileSync(join(here, file), join(ext, file === "extension.mjs" ? "index.mjs" : file));
    writeFileSync(
      join(ext, "package.json"),
      '{"type":"module","pi":{"extensions":["./index.mjs"]}}\n',
    );
    writeFileSync(
      join(ext, "worker.json"),
      JSON.stringify(
        {
          container,
          events: join(root, `${slug}.jsonl`),
          jevDir,
          limits: config.smokeLimits,
          judges: config.judges,
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(dir, "AGENTS.md"),
      "# Readiness worker\n\nYour project is /work through work_shell.\nDo only the teacher's readiness check.\n",
    );
    run("git", ["-C", dir, "init", "-q"]);
    const trustPath = join(homedir(), ".pi/agent/trust.json");
    const trust = existsSync(trustPath) ? JSON.parse(readFileSync(trustPath)) : {};
    trust[dir] = true;
    writeFileSync(trustPath, JSON.stringify(trust, null, 2) + "\n");
    const project = JSON.parse(run("paseo", ["project", "create", dir, "--json"]));
    worker.projectId = project.projectId ?? project.project?.id ?? project.id;
    if (!worker.projectId)
      throw new Error(`Unexpected project response: ${JSON.stringify(project)}`);
    save(manifest);
    const workspace = JSON.parse(
      run("paseo", [
        "workspace",
        "create",
        "--isolation",
        "local",
        "--path",
        dir,
        "--project",
        worker.projectId,
        "--title",
        `Writer readiness: ${model.split("/")[1]}`,
        "--json",
      ]),
    );
    worker.workspaceId = workspace.workspaceId ?? workspace.workspace?.id ?? workspace.id;
    if (!worker.workspaceId)
      throw new Error(`Unexpected workspace response: ${JSON.stringify(workspace)}`);
    worker.status = "prepared";
    save(manifest);
    console.log(JSON.stringify(worker));
  }
} else if (action === "stage") {
  const round = Number(process.argv[4]);
  if (![1, 2, 3, 4].includes(round)) throw new Error("Stage needs round 1, 2, 3, or 4");
  const manifest = JSON.parse(readFileSync(manifestPath));
  if (manifest.round && round !== manifest.round + 1) throw new Error("Stage the next round only");
  if (manifest.round && manifest.exportedRound !== manifest.round)
    throw new Error("Export the previous round before staging the next");
  const packets = ["01-book-cancel.md", "02-edit.md", "03-series.md", "04-undo.md"];
  const task = packets
    .slice(0, round)
    .map((file) => readFileSync(join(here, "packets", file), "utf8"))
    .join("\n\n---\n\n");
  const taskFile = join(root, "current-task.md");
  writeFileSync(taskFile, task);
  for (const w of manifest.workers) {
    if (w.status === "cleaned") throw new Error("Create a fresh trial before staging");
    run("docker", ["start", w.container]);
    run("docker", ["cp", taskFile, `${w.container}:/work/TASK.md`]);
    const ext = join(w.dir, ".pi/extensions/trial");
    for (const file of ["extension.mjs", "broker.mjs"])
      copyFileSync(join(here, file), join(ext, file === "extension.mjs" ? "index.mjs" : file));
    const cfgPath = join(ext, "worker.json");
    const cfg = JSON.parse(readFileSync(cfgPath));
    cfg.limits = config.limits;
    cfg.events = join(root, `${w.container}-round-${round}.jsonl`);
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    w.status = "staged";
  }
  manifest.phase = "scored";
  manifest.round = round;
  save(manifest);
  console.log(`Round ${round} staged. No agents launched.`);
} else if (action === "export") {
  const manifest = JSON.parse(readFileSync(manifestPath));
  const resultDir = join(root, "results", `round-${manifest.round ?? "readiness"}`);
  if (existsSync(resultDir))
    throw new Error("This round was already exported; preserve the existing evidence");
  mkdirSync(resultDir, { recursive: true });
  for (const [i, w] of manifest.workers.entries()) {
    const snapshot = execFileSync("docker", ["cp", `${w.container}:/work/.`, "-"], {
      maxBuffer: 64e6,
    });
    writeFileSync(join(resultDir, `worker-${i + 1}.tar`), snapshot);
  }
  manifest.exportedRound = manifest.round ?? "readiness";
  manifest.exportedAt = new Date().toISOString();
  save(manifest);
  console.log("Saved worker archives outside temporary projects.");
} else if (action === "cleanup") {
  const manifest = JSON.parse(readFileSync(manifestPath));
  if (!manifest.exportedAt) throw new Error("Export results before cleanup");
  for (const w of manifest.workers) {
    if (w.status === "cleaned") continue;
    if (w.workspaceId) run("paseo", ["workspace", "archive", w.workspaceId, "--json"]);
    if (w.projectId) run("paseo", ["project", "delete", w.projectId, "--json"]);
    const containers = run("docker", ["ps", "-a", "--format", "{{.Names}}"]).trim().split("\n");
    if (containers.includes(w.container)) run("docker", ["rm", "-f", w.container]);
    const volumes = run("docker", ["volume", "ls", "--format", "{{.Name}}"]).trim().split("\n");
    if (volumes.includes(w.volume)) run("docker", ["volume", "rm", w.volume]);
    if (!w.dir.startsWith(root + "/") || w.dir === root) throw new Error("Unsafe cleanup path");
    const trustPath = join(homedir(), ".pi/agent/trust.json");
    const trust = JSON.parse(readFileSync(trustPath));
    delete trust[w.dir];
    writeFileSync(trustPath, JSON.stringify(trust, null, 2) + "\n");
    rmSync(w.dir, { recursive: true, force: true });
    w.status = "cleaned";
    save(manifest);
  }
  manifest.cleanedAt = new Date().toISOString();
  save(manifest);
  console.log("Archived workspaces; deleted projects, containers, volumes, and worker folders.");
} else throw new Error("Use create, stage, export, or cleanup");
