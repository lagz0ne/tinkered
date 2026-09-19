import { operation, resource } from "@tinker/core";
import * as esbuild from "esbuild-wasm";
import { raise } from "@/errors.ts";
import type { PlaygroundFile } from "@/lib/files.ts";
import { entry } from "@/state.ts";

export declare namespace Compiler {
  /** The seam: the one call the shell makes of its compiler. The real one is esbuild-wasm over a
   * virtual file system; a test presets a `Map` lookup. A resource's value is its consumer's seam,
   * so it is the smallest shape the consumer calls — never the whole module behind it. */
  export type Handle = {
    bundle(entry: string, files: readonly PlaygroundFile[]): Promise<string>;
  };
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
        return { path: args.path, external: true };
      });
      build.onLoad({ filter: /.*/, namespace: "vfs" }, (args) => {
        const file = byName.get(args.path);
        if (!file) return { errors: [{ text: `Missing "${args.path}"` }] };
        return { contents: file.content, loader: args.path.endsWith(".ts") ? "ts" : "tsx" };
      });
    },
  };
}

const readMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^.*ERROR:\s*/s, "");
};

/** esbuild-wasm behind the {@link Compiler.Handle} seam, booted once per scope and cached: every
 * compile shares the one instance, and the first compile simply waits for the boot. */
export const compiler = resource({
  label: "compiler",
  factory: async (): Promise<Compiler.Handle> => {
    await esbuild.initialize({ wasmURL: "/esbuild.wasm" });
    return {
      bundle: async (entry, files) => {
        try {
          const result = await esbuild.build({
            entryPoints: [entry],
            bundle: true,
            write: false,
            format: "esm",
            platform: "browser",
            target: "es2020",
            jsx: "automatic",
            plugins: [virtualFs(files)],
            logLevel: "silent",
          });
          const [output] = result.outputFiles;
          return output.text;
        } catch (error) {
          raise("CompileFailed", { message: readMessage(error) });
        }
      },
    };
  },
});

const isFile = (value: unknown): value is PlaygroundFile =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as PlaygroundFile).name === "string" &&
  typeof (value as PlaygroundFile).content === "string";

/** Bundle the open files from the entry tag into one ESM module. Fails with `CompileFailed`. */
export const compile = operation({
  label: "compile",
  input: (raw) =>
    Array.isArray(raw) && raw.every(isFile)
      ? (raw as PlaygroundFile[])
      : raise("InvalidInput", { operation: "compile", reason: "expected files" }),
  depends: { compiler, entry: entry.required },
  run: ({ compiler: seam, entry }, { input: files }) => seam.bundle(entry, files),
});
