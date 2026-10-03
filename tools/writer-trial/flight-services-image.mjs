import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Copy the landed entries and pin every dependency to its installed version. */
export function prepareServices(repo, context) {
  const tool = join(repo, "tools/flight-trial");
  mkdirSync(context, { recursive: true });
  for (const dir of ["services", "src", "data"])
    cpSync(join(tool, dir), join(context, dir), { recursive: true });
  mkdirSync(join(context, "scripts"), { recursive: true });
  copyFileSync(
    join(repo, "tools/writer-trial/flight-service.mjs"),
    join(context, "scripts/service.mjs"),
  );
  copyFileSync(join(repo, "tools/writer-trial/flight-proxy.mjs"), join(context, "proxy.mjs"));
  const dependencies = {};
  for (const name of Object.keys(
    JSON.parse(readFileSync(join(tool, "package.json"))).dependencies,
  )) {
    const pkg = JSON.parse(readFileSync(join(tool, "node_modules", name, "package.json")));
    if (name.startsWith("@tinker/")) {
      const archive = `${name.split("/").at(-1)}.tgz`;
      execFileSync(
        "pnpm",
        [
          "--dir",
          join(repo, "packages", name.split("/").at(-1)),
          "pack",
          "--out",
          join(context, archive),
        ],
        { stdio: "inherit" },
      );
      dependencies[name] = `file:./${archive}`;
    } else dependencies[name] = pkg.version;
  }
  writeFileSync(
    join(context, "package.json"),
    JSON.stringify({ private: true, type: "module", dependencies }, null, 2) + "\n",
  );
  writeFileSync(join(context, ".dockerignore"), "image.tar\nimage.json\n");
  writeFileSync(
    join(context, "Dockerfile"),
    `FROM node:24-trixie-slim
WORKDIR /service
COPY . .
RUN npm install --ignore-scripts --no-audit --no-fund
USER node
CMD ["node", "scripts/service.mjs"]
`,
  );
}

/** A saved image keeps both its exact bytes and an idle keeper container. */
export function buildServices(context, image) {
  if (existsSync(join(context, "image.json")))
    throw new Error(`Service image already saved: ${context}`);
  execFileSync("docker", ["build", "-t", image, context], { stdio: "inherit" });
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      `tinker-flight-keep-${image.split(":").at(-1)}-services`,
      "--restart",
      "unless-stopped",
      "--network",
      "none",
      "--read-only",
      "--memory",
      "64m",
      image,
      "sleep",
      "infinity",
    ],
    { stdio: "inherit" },
  );
  execFileSync("docker", ["save", "-o", join(context, "image.tar"), image]);
  const id = execFileSync("docker", ["image", "inspect", image, "--format", "{{.Id}}"], {
    encoding: "utf8",
  }).trim();
  writeFileSync(join(context, "image.json"), JSON.stringify({ image: id }, null, 2) + "\n");
  return id;
}

if (import.meta.main) {
  const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  execFileSync(join(repo, "node_modules/.bin/vp"), ["run", "core#build"], {
    cwd: repo,
    stdio: "inherit",
  });
  const path = join(repo, "tools/writer-trial/config.json");
  const config = JSON.parse(readFileSync(path));
  const tag = new Date().toISOString().replace(/[^0-9]/g, "");
  const image = `tinker-flight-services:${tag}`;
  const context = join(homedir(), ".local/share/tinker-writer-trial", `services-${tag}`);
  prepareServices(repo, context);
  const id = buildServices(context, image);
  config.flight.servicesImage = image;
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
  console.log(`Services ${image} ${id}; saved ${context}/image.tar`);
}
