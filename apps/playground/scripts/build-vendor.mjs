// Builds the self-hosted vendor bundles the preview iframe imports through its import map.
//
// - @tinker/core / @tinker/react: copied straight from their built dist (core has no deps; the
//   react adapter's only runtime import is bare "react", resolved by the map to the shared copy).
// - react / react-dom(/client) / react/jsx-runtime: bundled from node_modules into browser ESM,
//   with "react" kept external so there is exactly ONE React instance across user code + adapter.
//
// Output: apps/playground/public/vendor/*.mjs and public/esbuild.wasm.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(appDir));
const outDir = join(appDir, "public", "vendor");
mkdirSync(outDir, { recursive: true });

// 1. The library: copy the built dist verbatim (bare "react" import stays, map resolves it).
const copies = [
  [join(repoRoot, "packages/core/dist/index.mjs"), "core.mjs"],
  [join(repoRoot, "packages/react/dist/index.mjs"), "tinker-react.mjs"],
];
for (const [from, name] of copies) {
  writeFileSync(join(outDir, name), readFileSync(from));
}

// 2. React & friends: bundle CJS -> browser ESM. "react" external => shared single instance.
// These subpaths reassign `module.exports`, so `export *`/`export { default }` can't enumerate the
// named exports — read the real keys off the loaded module and re-export every one explicitly.
const isName = (k) => k !== "default" && k !== "__esModule" && /^[A-Za-z_$][\w$]*$/.test(k);
function named(spec) {
  const keys = Object.keys(require(spec)).filter(isName);
  return `import M from "${spec}"; export default M; export const { ${keys.join(", ")} } = M;`;
}

// react-dom is CJS and does `require("react")` internally; with react external + esm output esbuild
// leaves that as a runtime `require` stub. This banner maps that one require to the ESM-imported,
// shared React so there is still exactly one React instance — and no runtime `require` is needed.
const reactRequireShim =
  `import __sharedReact from "react";\n` +
  `function require(id) { if (id === "react") return __sharedReact; throw new Error("Unexpected require: " + id); }`;

const bundles = [
  { name: "react.mjs", entry: named("react"), external: [] },
  // jsx-runtime only builds element objects (identity via global symbols), so a self-contained
  // copy is safe; keeping "react" external here would make esbuild self-reference the subpath.
  { name: "react-jsx-runtime.mjs", entry: named("react/jsx-runtime"), external: [] },
  { name: "react-dom.mjs", entry: named("react-dom"), external: ["react"] },
  { name: "react-dom-client.mjs", entry: named("react-dom/client"), external: ["react"] },
];
for (const { name, entry, external } of bundles) {
  await build({
    stdin: { contents: entry, resolveDir: appDir, loader: "js" },
    outfile: join(outDir, name),
    bundle: true,
    format: "esm",
    platform: "browser",
    external,
    banner: external.includes("react") ? { js: reactRequireShim } : undefined,
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });
}

// 3. The in-browser compiler binary, served as a static asset. It MUST embed the same version as
// the esbuild-wasm JS that Vite bundles into the app — a mismatch makes esbuild refuse to start
// ("Host version X does not match binary version Y"). Copy from the resolved package and verify.
const wasmSrc = require.resolve("esbuild-wasm/esbuild.wasm");
const wasmDest = join(appDir, "public", "esbuild.wasm");
copyFileSync(wasmSrc, wasmDest);

const hostVersion = require("esbuild-wasm/package.json").version;
// esbuild versions are always 0.x; the binary embeds its own version as a "0.NN.N" string.
const embedded = readFileSync(wasmDest)
  .toString("latin1")
  .match(/0\.\d+\.\d+/)?.[0];
if (embedded !== hostVersion) {
  throw new Error(
    `esbuild.wasm version mismatch: host esbuild-wasm is ${hostVersion} but the copied binary embeds ${embedded}. ` +
      `Resolved wasm: ${wasmSrc}`,
  );
}

console.log(`vendor bundles written to ${outDir} (esbuild-wasm ${hostVersion})`);
