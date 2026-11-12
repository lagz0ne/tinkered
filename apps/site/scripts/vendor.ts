import { mkdir, rm } from "node:fs/promises";

/**
 * Before `vp build` and `vp dev`: writes the modules the play preview loads through its import
 * map into public/vendor, and the in-browser compiler into public/esbuild.wasm. Vite copies
 * public/ into dist/client, so the binary serves them as it serves the page.
 * - One React and one Core for the user's code and for @tinkered/react: both stay bare imports.
 * - React is CommonJS: each entry names its exports, so `import { useState }` works.
 */
const site = new URL("../", import.meta.url).pathname;
const out = `${site}public/vendor`;
const entries = `${site}node_modules/.cache/vendor`;

await rm(out, { recursive: true, force: true });
await mkdir(entries, { recursive: true });

/** `import M from spec; export default M; export const { a, b } = M;` for a CommonJS module. */
const named = async (spec: string) => {
  const keys = Object.keys(await import(spec)).filter(
    (k) => k !== "default" && k !== "__esModule" && /^[A-Za-z_$][\w$]*$/.test(k),
  );
  return `import M from "${spec}"; export default M; export const { ${keys.join(", ")} } = M;`;
};

const modules = [
  { name: "core", from: "export * from '@tinkered/core';", external: [] },
  {
    name: "tinker-react",
    from: "export * from '@tinkered/react';",
    external: ["react", "@tinkered/core"],
  },
  { name: "zod", from: "export * from 'zod';", external: [] },
  { name: "react", from: await named("react"), external: [] },
  { name: "react-jsx-runtime", from: await named("react/jsx-runtime"), external: [] },
  { name: "react-dom", from: await named("react-dom"), external: ["react"] },
  {
    name: "react-dom-client",
    from: await named("react-dom/client"),
    external: ["react", "react-dom"],
  },
];

for (const { name, from, external } of modules) {
  // Only the exact name stays bare: Bun's own `external` would keep `react-dom/client` out too.
  const bare: Bun.BunPlugin = {
    name: "bare",
    setup: (build) => {
      build.onResolve({ filter: /^[@\w]/ }, (args) =>
        external.includes(args.path) ? { path: args.path, external: true } : undefined,
      );
    },
  };
  const entry = `${entries}/${name}.js`;
  await Bun.write(entry, from);
  const built = await Bun.build({
    entrypoints: [entry],
    format: "esm",
    target: "browser",
    plugins: [bare],
    minify: true,
    naming: `${name}.mjs`,
    outdir: out,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!built.success) throw new AggregateError(built.logs, `vendor ${name} failed`);
}

// The wasm binary must be the version of the esbuild-wasm the page bundles, or esbuild refuses
// to start ("Host version X does not match binary version Y").
const wasm = Bun.file(Bun.resolveSync("esbuild-wasm/esbuild.wasm", site));
const host = (await import("esbuild-wasm/package.json")).version as string;

const embedded = Buffer.from(await wasm.arrayBuffer())
  .toString("latin1")
  .match(/0\.\d+\.\d+/)?.[0];

if (embedded !== host) throw new Error(`esbuild.wasm is ${embedded}, esbuild-wasm is ${host}`);
await Bun.write(`${site}public/esbuild.wasm`, wasm);

console.log(`vendor: ${modules.length} modules and esbuild.wasm ${host}`);
