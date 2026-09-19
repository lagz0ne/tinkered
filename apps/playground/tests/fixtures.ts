import type { Compiler } from "@/compiler.ts";
import { raise } from "@/errors.ts";
import type { PlaygroundFile } from "@/lib/files.ts";
import type { Saved, Storage } from "@/state.ts";

/** A Map-backed session store: what `localStorage` does minus the browser — a save keeps a copy,
 * a load returns the copy or nothing. `seed` is the session a returning visitor left behind. */
export function fakeStorage(seed?: Saved): Storage.Handle {
  const store = new Map<string, Saved>();
  if (seed) store.set("session", structuredClone(seed));
  return {
    load: () => {
      const saved = store.get("session");
      return saved === undefined ? undefined : structuredClone(saved);
    },
    save: (saved) => store.set("session", structuredClone(saved)),
  };
}

const RELATIVE = /from\s+"(\.\/[^"]+)"|import\s+"(\.\/[^"]+)"/g;

/** Every file reachable from `entry` through `./name` imports, entry first; a missing one fails the
 * way the real compiler does. */
function reachable(entry: string, files: readonly PlaygroundFile[]): PlaygroundFile[] {
  const byName = new Map(files.map((f) => [f.name, f]));
  const find = (path: string) => {
    const base = path.replace(/^\.\//, "");
    return [base, `${base}.tsx`, `${base}.ts`].map((n) => byName.get(n)).find((f) => f);
  };
  const out: PlaygroundFile[] = [];
  const visit = (file: PlaygroundFile | undefined, path: string) => {
    if (!file)
      raise("CompileFailed", { message: `[plugin: virtual-fs] Cannot find file "${path}"` });
    if (out.includes(file)) return;
    out.push(file);
    for (const [, from, bare] of file.content.matchAll(RELATIVE)) {
      const path = from ?? bare;
      visit(find(path), path);
    }
  };
  visit(byName.get(entry), entry);
  return out;
}

/** A compiler behind the seam that concatenates the reachable files: the bundle is a function of
 * the sources, so a test can read what was compiled. `seen` records every bundle; `gate` holds a
 * compile open until the test releases it (stale results, timing). */
export function fakeCompiler(seen: string[], gate?: () => Promise<void>): Compiler.Handle {
  return {
    bundle: async (entry, files) => {
      const text = reachable(entry, files)
        .map((f) => f.content)
        .join("\n");
      seen.push(text);
      await gate?.();
      return text;
    },
  };
}
