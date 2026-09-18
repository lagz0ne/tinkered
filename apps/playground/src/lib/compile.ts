import * as esbuild from "esbuild-wasm";
import { ENTRY, type PlaygroundFile } from "@/lib/files.ts";

let initPromise: Promise<void> | undefined;
/** esbuild-wasm boots once; every keystroke reuses the same instance. */
function ready(): Promise<void> {
  return (initPromise ??= esbuild.initialize({ wasmURL: "/esbuild.wasm" }));
}

/** Resolves relative imports against the open tabs; bare specifiers stay external (import map). */
function virtualFs(files: readonly PlaygroundFile[]): esbuild.Plugin {
  const byName = new Map(files.map((f) => [f.name, f]));
  const resolveName = (path: string): string | undefined => {
    const base = path.replace(/^\.\//, "");
    for (const cand of [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`]) {
      if (byName.has(cand)) return cand;
    }
    return undefined;
  };
  return {
    name: "virtual-fs",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return { path: args.path, namespace: "vfs" };
        if (args.path.startsWith(".")) {
          const name = resolveName(args.path);
          return name
            ? { path: name, namespace: "vfs" }
            : { errors: [{ text: `Cannot find file "${args.path}"` }] };
        }
        return { path: args.path, external: true }; // react, @tinker/* → import map
      });
      build.onLoad({ filter: /.*/, namespace: "vfs" }, (args) => {
        const file = byName.get(args.path);
        if (!file) return { errors: [{ text: `Missing "${args.path}"` }] };
        return { contents: file.content, loader: args.path.endsWith(".ts") ? "ts" : "tsx" };
      });
    },
  };
}

export type CompileResult = { ok: true; code: string } | { ok: false; error: string };

export async function compile(files: readonly PlaygroundFile[]): Promise<CompileResult> {
  await ready();
  try {
    const result = await esbuild.build({
      entryPoints: [ENTRY],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2020",
      jsx: "automatic",
      plugins: [virtualFs(files)],
      logLevel: "silent",
    });
    return { ok: true, code: result.outputFiles[0].text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message.replace(/^.*ERROR:\s*/s, "") };
  }
}
