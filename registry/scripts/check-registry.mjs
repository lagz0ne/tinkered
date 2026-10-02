import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(await readFile(join(root, "registry.json"), "utf8"));
const payloads = new Map();
for (const item of registry.items) {
  const text = await readFile(join(root, "public/r", `${item.name}.json`), "utf8");
  const payload = JSON.parse(text);
  for (const file of item.files) {
    const emitted = payload.files.find((candidate) => candidate.path === file.path);
    assert.ok(emitted, file.path);
    assert.equal(emitted.target, file.target);
    assert.equal(emitted.content, await readFile(join(root, file.path), "utf8"));
  }
  payloads.set(`/r/${item.name}.json`, text);
}
const server = createServer((request, response) => {
  const payload = payloads.get(request.url);
  response.writeHead(payload ? 200 : 404, { "content-type": "application/json" });
  response.end(payload ?? "{}");
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address !== "string");
const consumer = await mkdtemp(join(tmpdir(), "tinker-source-registry-"));
async function run(args) {
  const child = spawn("vp", args, { cwd: consumer, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const code = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
  });
  assert.equal(code, 0, output);
  return output;
}
try {
  await mkdir(join(consumer, "vendor"));
  execFileSync("vp", ["pm", "pack", "--out", join(consumer, "vendor/core.tgz")], {
    cwd: join(root, "../packages/core"),
    stdio: "pipe",
  });
  const manifest = {
    name: "copied-source-proof",
    private: true,
    type: "module",
    packageManager: "pnpm@12.4.1",
    dependencies: { "@tinker/core": "file:./vendor/core.tgz", zod: "^4.0.0" },
    devDependencies: { "@types/node": "26.5.1", typescript: "7.0.2", "vite-plus": "0.3.1" },
  };
  await writeFile(join(consumer, "package.json"), JSON.stringify(manifest, null, 2));
  await writeFile(
    join(consumer, "components.json"),
    JSON.stringify({
      $schema: "https://ui.shadcn.com/schema.json",
      style: "new-york",
      rsc: false,
      tsx: true,
      tailwind: { css: "src/style.css", baseColor: "neutral", cssVariables: true },
      aliases: {
        components: "@/components",
        utils: "@/lib/utils",
        ui: "@/components/ui",
        lib: "@/lib",
        hooks: "@/hooks",
      },
    }),
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "esnext",
        lib: ["es2024", "dom"],
        types: ["node"],
        module: "nodenext",
        moduleResolution: "nodenext",
        strict: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        esModuleInterop: true,
        skipLibCheck: true,

        paths: { "@/*": ["./src/*"] },
      },
      include: ["src/**/*.ts"],
    }),
  );
  await writeFile(join(consumer, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await run(["install", "--prefer-offline"]);
  const cli = ["dlx", "--", "shadcn@4.21.0"];
  await run([
    ...cli,
    "registry",
    "add",
    `@tinker-source=http://127.0.0.1:${address.port}/r/{name}.json`,
  ]);
  await run([...cli, "add", "@tinker-source/tinkerer", "--yes", "--overwrite"]);
  const selected = registry.items.filter((item) => ["http", "tinkerer"].includes(item.name));
  for (const item of selected) {
    for (const file of item.files) {
      assert.equal(
        await readFile(join(consumer, file.target.slice(2)), "utf8"),
        await readFile(join(root, file.path), "utf8"),
      );
    }
  }
  await run(["exec", "tsc", "--noEmit"]);
  await mkdir(join(consumer, "src/feature"), { recursive: true });
  const feature =
    "/** App-owned code stays here after a source update. */\nexport const feature = 42;\n";
  await writeFile(join(consumer, "src/feature/index.ts"), feature);
  const source = "src/tinker/http/index.ts";
  const original = await readFile(join(consumer, source), "utf8");
  await writeFile(join(consumer, source), "/** Older copied source. */\n" + original);
  const diff = await run([...cli, "add", "@tinker-source/http", "--dry-run", "--diff", source]);
  assert.ok(diff.includes("Older copied source"));
  assert.equal(
    await readFile(join(consumer, source), "utf8"),
    "/** Older copied source. */\n" + original,
  );
  await run([...cli, "add", "@tinker-source/http", "--yes", "--overwrite"]);
  assert.equal(await readFile(join(consumer, source), "utf8"), original);
  assert.equal(await readFile(join(consumer, "src/feature/index.ts"), "utf8"), feature);
  await run(["exec", "tsc", "--noEmit"]);
  const files = await readdir(join(consumer, "src/tinker"));
  assert.deepEqual(files.sort(), ["http", "tinkerer"]);
  console.log(
    "PASS: 13 payloads match source; shadcn installs the fixed tinkerer/http graph; copied source checks; update preserves feature files.",
  );
  console.log("Core is an unreleased local archive; native dependencies install outside the repo.");
} finally {
  await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
  await rm(consumer, { recursive: true, force: true });
}
