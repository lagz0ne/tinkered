import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, sha256File } from "./suite.mjs";

export function prepareFlight(repo, home, config, build) {
  const context = join(home, `image-${config.flight.image.split(":").at(-1)}`);
  if (existsSync(join(context, "image.json"))) {
    throw new Error(`Flight image already saved: ${context}; use a new tag to rebuild`);
  }
  const seed = join(context, "seed");
  mkdirSync(seed, { recursive: true });
  const app = join(repo, "apps/start-scaffold");
  const registry = JSON.parse(readFileSync(join(app, "registry.json")));
  const included = new Set();
  const copyItem = (name) => {
    if (included.has(name)) return;
    const item = registry.items.find((row) => row.name === name);
    if (!item) throw new Error(`Missing registry item ${name}`);
    for (const dependency of item.registryDependencies ?? [])
      copyItem(dependency.split("/").at(-1));
    for (const file of item.files) {
      const target = file.target.startsWith("@lib/")
        ? file.target.replace("@lib/", "src/lib/")
        : file.target.slice(2);
      mkdirSync(join(seed, target, ".."), { recursive: true });
      copyFileSync(join(app, file.path), join(seed, target));
    }
    included.add(name);
  };
  copyItem("starter");
  copyFileSync(join(app, "components.json"), join(seed, "components.json"));
  const pkg = JSON.parse(readFileSync(join(seed, "package.json")));
  for (const name of ["core", "react"]) {
    execFileSync(
      "pnpm",
      ["--dir", join(repo, "packages", name), "pack", "--out", join(seed, `${name}.tgz`)],
      { stdio: "inherit" },
    );
    pkg.dependencies[`@tinker/${name}`] = `file:./${name}.tgz`;
  }
  pkg.devDependencies.playwright = "1.63.0";
  writeFileSync(join(seed, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  execFileSync(join(repo, "node_modules/.bin/vp"), ["fmt", join(seed, "package.json")], {
    stdio: "inherit",
  });
  writeFileSync(
    join(seed, ".gitignore"),
    "node_modules/\ndist/\n.env\n.vite/\nsrc/routeTree.gen.ts\n",
  );
  writeFileSync(
    join(seed, ".oxfmtrc.json"),
    '{\n  "ignorePatterns": ["src/routeTree.gen.ts", "FEEDBACK.md", "TASK.md"]\n}\n',
  );
  execFileSync(join(repo, "node_modules/.bin/vp"), ["fmt", join(seed, ".oxfmtrc.json")], {
    stdio: "inherit",
  });
  const scaffold = {};
  for (const file of registry.items.find((item) => item.name === "runtime").files)
    scaffold[file.path] = sha256File(join(seed, file.path));
  writeFileSync(join(context, "scaffold.json"), JSON.stringify(scaffold, null, 2) + "\n");
  const starter = Object.fromEntries(
    listFiles(seed)
      .filter((file) => /^(src|tests)\//.test(file) && /\.tsx?$/.test(file))
      .map((file) => [file, sha256File(join(seed, file))]),
  );
  writeFileSync(join(context, "starter.json"), JSON.stringify(starter, null, 2) + "\n");
  writeFileSync(
    join(context, "Dockerfile"),
    `FROM mcr.microsoft.com/playwright:v1.63.0-noble
USER root
RUN mkdir -p /work /home/pwuser/flight-tools /home/pwuser/flight-seed && chown -R pwuser:pwuser /work /home/pwuser/flight-tools /home/pwuser/flight-seed
COPY --chown=pwuser:pwuser seed/ /home/pwuser/flight-seed/
COPY --chown=pwuser:pwuser scaffold.json /home/pwuser/scaffold.json
USER pwuser
WORKDIR /home/pwuser/flight-tools
RUN cp /home/pwuser/flight-seed/package.json . && cp /home/pwuser/flight-seed/*.tgz . && npm install --ignore-scripts --no-audit --no-fund
RUN ln -s /tmp node_modules/.vite && ln -s /tmp node_modules/.vite-temp
ENV PATH="/home/pwuser/flight-tools/node_modules/.bin:$PATH"
WORKDIR /work
RUN cp -R /home/pwuser/flight-seed/. . && ln -s /home/pwuser/flight-tools/node_modules node_modules
COPY --chown=pwuser:pwuser starter.json /home/pwuser/starter.json
RUN ln -s /home/pwuser/flight-tools/node_modules /home/pwuser/flight-seed/node_modules
CMD ["sleep", "infinity"]
`,
  );
  const services = join(context, "services");
  mkdirSync(services, { recursive: true });
  cpSync(join(repo, "tools/flight-trial/dist"), join(services, "dist"), { recursive: true });
  cpSync(join(repo, "tools/flight-trial/data"), join(services, "data"), { recursive: true });
  mkdirSync(join(services, "scripts"), { recursive: true });
  copyFileSync(
    join(repo, "tools/flight-trial/scripts/service.mjs"),
    join(services, "scripts/service.mjs"),
  );
  copyFileSync(join(seed, "core.tgz"), join(services, "core.tgz"));
  copyFileSync(join(repo, "tools/writer-trial/flight-proxy.mjs"), join(services, "proxy.mjs"));
  writeFileSync(
    join(services, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        "@tinker/core": "file:./core.tgz",
        zod: JSON.parse(
          readFileSync(join(repo, "tools/flight-trial/node_modules/zod/package.json")),
        ).version,
      },
    }),
  );
  writeFileSync(
    join(services, "Dockerfile"),
    `FROM node:24-trixie-slim
WORKDIR /service
COPY . .
RUN npm install --ignore-scripts --no-audit --no-fund
USER node
CMD ["node", "scripts/service.mjs"]
`,
  );
  if (!build) return context;
  for (const [dir, image] of [
    [context, config.flight.image],
    [services, config.flight.servicesImage],
  ]) {
    execFileSync("docker", ["build", "-t", image, dir], { stdio: "inherit" });
    const keeper = `tinker-flight-keep-${image.split(":").at(-1)}-${dir === context ? "app" : "services"}`;
    execFileSync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        keeper,
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
  }
  for (const [dir, image] of [
    [context, config.flight.image],
    [services, config.flight.servicesImage],
  ]) {
    execFileSync("docker", ["save", "-o", join(dir, "image.tar"), image]);
  }
  const inspect = (image) =>
    execFileSync("docker", ["image", "inspect", image, "--format", "{{.Id}}"], {
      encoding: "utf8",
    }).trim();
  writeFileSync(
    join(context, "image.json"),
    JSON.stringify(
      {
        image: inspect(config.flight.image),
        servicesImage: inspect(config.flight.servicesImage),
        scaffold,
      },
      null,
      2,
    ) + "\n",
  );
  return context;
}
