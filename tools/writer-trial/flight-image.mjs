import { execFileSync } from "node:child_process";
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, sha256File } from "./suite.mjs";
import { prepareServices, buildServices } from "./flight-services-image.mjs";
import { keepFlightDependencies } from "./flight-network.mjs";

export function prepareFlight(repo, home, config, build, appOnly = false) {
  const context = join(home, `image-${config.flight.image.split(":").at(-1)}`);
  if (existsSync(join(context, "image.json"))) {
    throw new Error(`Flight image already saved: ${context}; use a new tag to rebuild`);
  }
  mkdirSync(context, { recursive: true });
  writeFileSync(join(context, ".dockerignore"), "services/\nimage.tar\nimage.tar.gz\nimage.json\n");
  const seed = join(context, "seed");
  mkdirSync(seed, { recursive: true });
  const { pkg, base } = packSeed(repo, seed);
  pkg.devDependencies.playwright = "1.63.0";
  writeFileSync(join(seed, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  execFileSync(join(repo, "node_modules/.bin/vp"), ["fmt", join(seed, "package.json")], {
    stdio: "inherit",
  });
  writeFileSync(
    join(seed, ".gitignore"),
    "node_modules/\ndist/\n.env\n.vite/\n.tinker/\n.tanstack/\nsrc/routeTree.gen.ts\n",
  );
  writeFileSync(
    join(seed, ".oxfmtrc.json"),
    '{\n  "ignorePatterns": [".tinker/**", ".tanstack/**", "src/routeTree.gen.ts", "FEEDBACK.md", "TASK.md"]\n}\n',
  );
  execFileSync(join(repo, "node_modules/.bin/vp"), ["fmt", join(seed, ".oxfmtrc.json")], {
    stdio: "inherit",
  });
  writeFileSync(
    join(seed, ".prettierignore"),
    "TASK.md\nFEEDBACK.md\n.tinker/\n.tanstack/\nsrc/routeTree.gen.ts\n",
  );
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
USER pwuser
WORKDIR /home/pwuser/flight-tools
RUN cp /home/pwuser/flight-seed/package.json . && cp /home/pwuser/flight-seed/*.tgz . && npm install --ignore-scripts --no-audit --no-fund
RUN ln -s /tmp node_modules/.vite && ln -s /tmp node_modules/.vite-temp && ln -s /tmp node_modules/.vitest
ENV PATH="/home/pwuser/flight-tools/node_modules/.bin:$PATH"
WORKDIR /work
RUN cp -R /home/pwuser/flight-seed/. . && ln -s /home/pwuser/flight-tools/node_modules node_modules && tinker prepare
COPY --chown=pwuser:pwuser starter.json /home/pwuser/starter.json
RUN ln -s /home/pwuser/flight-tools/node_modules /home/pwuser/flight-seed/node_modules
CMD ["sleep", "infinity"]
`,
  );
  const services = join(context, "services");
  if (!appOnly) prepareServices(repo, services);
  if (!build) return context;
  const image = config.flight.image;
  execFileSync("docker", ["build", "-t", image, context], { stdio: "inherit" });
  const keeper = `tinker-flight-keep-${image.split(":").at(-1)}-app`;
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
  execFileSync("docker", ["save", "-o", join(context, "image.tar"), image]);
  execFileSync("gzip", [join(context, "image.tar")]);
  if (!appOnly) {
    buildServices(services, config.flight.servicesImage);
    keepFlightDependencies(config.flight);
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
        base: { version: base.version, tested: base.tinker.tested },
      },
      null,
      2,
    ) + "\n",
  );
  return context;
}

function packSeed(repo, seed) {
  const app = join(repo, "apps/start-scaffold");
  for (const folder of ["src", "tests", "scripts", "drizzle", ".agents"])
    cpSync(join(app, folder), join(seed, folder), {
      recursive: true,
      filter: (path) => !path.endsWith("routeTree.gen.ts"),
    });
  for (const file of [
    "vite.config.ts",
    "vitest.config.ts",
    "tsconfig.json",
    "components.json",
    "drizzle.config.ts",
    "PLAIN.md",
    "AGENTS.md",
  ])
    copyFileSync(join(app, file), join(seed, file));
  copyFileSync(join(app, "starter.package.json"), join(seed, "package.json"));
  const pkg = JSON.parse(readFileSync(join(seed, "package.json")));
  for (const name of ["core", "react"]) {
    execFileSync(
      "pnpm",
      ["--dir", join(repo, "packages", name), "pack", "--out", join(seed, `${name}.tgz`)],
      { stdio: "inherit" },
    );
    pkg.dependencies[`@tinker/${name}`] = `file:./${name}.tgz`;
  }
  const base = JSON.parse(readFileSync(join(repo, "packages/start/package.json")));
  execFileSync("node", [join(repo, "packages/start/scripts/pack.mjs"), seed], { stdio: "inherit" });
  copyFileSync(join(seed, `tinker-start-${base.version}.tgz`), join(seed, "start.tgz"));
  pkg.dependencies["@tinker/start"] = "file:./start.tgz";
  for (const [name, pin] of Object.entries(base.tinker.tested))
    if (!name.startsWith("@tinker/")) pkg.dependencies[name] = pin;
  return { pkg, base };
}
