import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "../..");
const config = JSON.parse(readFileSync(join(here, "config.json")));
const home = join(homedir(), ".local/share/tinker-writer-trial");
mkdirSync(home, { recursive: true, mode: 0o700 });
// One build folder per image tag: a new tag never rewrites an older
// image's saved context. `image` is the 20260922 build's folder.
const tag = config.image.split(":").at(-1);
const context = join(home, tag === "20260922" ? "image" : `image-${tag}`);
mkdirSync(context, { recursive: true });
for (const name of ["core", "react"]) {
  const dir = join(context, name);
  mkdirSync(join(dir, "dist"), { recursive: true });
  for (const file of ["index.mjs", "index.d.mts"])
    copyFileSync(join(repo, "packages", name, "dist", file), join(dir, "dist", file));
  const pkg = JSON.parse(readFileSync(join(repo, "packages", name, "package.json")));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: pkg.name,
      version: pkg.version,
      type: "module",
      exports: { ".": { types: "./dist/index.d.mts", default: "./dist/index.mjs" } },
      ...(name === "react" ? { peerDependencies: { react: ">=19", "@tinker/core": "*" } } : {}),
    }),
  );
}
writeFileSync(
  join(context, "package.json"),
  JSON.stringify(
    {
      private: true,
      type: "module",
      dependencies: {
        "@tinker/core": "file:./core",
        "@tinker/react": "file:./react",
        react: "19.3.0",
        "react-dom": "19.3.0",
        "vite-plus": "0.3.1",
        typescript: "7.0.2",
        "@types/react": "^19",
        "@types/react-dom": "^19",
        "@types/node": "^24",
        playwright: "1.55.0",
      },
    },
    null,
    2,
  ),
);
writeFileSync(
  join(context, "Dockerfile"),
  `FROM mcr.microsoft.com/playwright:v1.55.0-noble
USER root
RUN mkdir -p /work /home/pwuser/toolchain && chown -R pwuser:pwuser /work /home/pwuser/toolchain
COPY --chown=pwuser:pwuser . /home/pwuser/toolchain/
USER pwuser
WORKDIR /home/pwuser/toolchain
RUN npm install --ignore-scripts --no-audit --no-fund
# node_modules is read-only in a trial; Vite's cache folders go to the writable /tmp.
RUN ln -s /tmp node_modules/.vite && ln -s /tmp node_modules/.vite-temp
ENV PATH="/home/pwuser/toolchain/node_modules/.bin:$PATH"
WORKDIR /work
RUN mkdir src tests docs && ln -s /home/pwuser/toolchain/node_modules node_modules
CMD ["sleep", "infinity"]
`,
);
if (process.argv.includes("--models")) {
  const response = await fetch("https://ai-gateway.vercel.sh/v1/models");
  if (!response.ok) throw new Error(`Catalog status ${response.status}`);
  const catalog = (await response.json()).data;
  const models = config.models.map((id) => {
    const m = catalog.find((x) => x.id === id);
    if (!m) throw new Error(`Missing model: ${id}`);
    const p = m.pricing;
    return {
      id,
      name: m.name,
      reasoning: true,
      input: ["text"],
      contextWindow: m.context_window,
      maxTokens: m.max_tokens,
      cost: {
        input: Number(p.input) * 1e6,
        output: Number(p.output) * 1e6,
        cacheRead: Number(p.input_cache_read ?? p.input) * 1e6,
        cacheWrite: Number(p.input) * 1e6,
      },
    };
  });
  const path = join(homedir(), ".pi/agent/models.json");
  const current = JSON.parse(readFileSync(path));
  const entry = {
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    api: "openai-completions",
    apiKey: "!cat /home/paseo/pilot/.ai-gateway-token",
    models,
  };
  if (
    current.providers[config.provider] &&
    JSON.stringify(current.providers[config.provider]) !== JSON.stringify(entry)
  )
    throw new Error("Existing writer provider differs; refusing overwrite");
  current.providers[config.provider] = entry;
  writeFileSync(path, JSON.stringify(current, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(
    join(home, "gateway-models.json"),
    JSON.stringify({ checkedAt: new Date().toISOString(), models }, null, 2),
  );
  console.log("Registered four gateway routes; key stays in its original file.");
}
if (process.argv.includes("--build")) {
  execFileSync("docker", ["build", "-t", config.image, "-"], {
    input: execFileSync("tar", ["-C", context, "-cf", "-", "."], { maxBuffer: 4e6 }),
    stdio: ["pipe", "inherit", "inherit"],
  });
}
console.log(home);
