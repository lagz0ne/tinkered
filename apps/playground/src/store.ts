// Dogfooding: the playground's OWN UI state lives in @tinker/core cells, read through @tinker/react
// hooks. The open files, the active tab, the editor theme, and the build status are each a reactive
// cell — no useState, no external store. This is the library building its own tool.
import { createScope, data, type Scope } from "@tinker/core";
import { DEFAULT_FILES, ENTRY, type PlaygroundFile } from "@/lib/files.ts";
import type { ThemeId } from "@/lib/themes.ts";

export type Status = { kind: "ok" | "error" | "info"; text: string };
export type View = "editor" | "bench";

const STORAGE = "tinkered-playground:v2";
type Persisted = { files: PlaygroundFile[]; active: string; theme: ThemeId; dirty?: boolean };

/** Restore the last session. Files come back only if the user actually edited them (`dirty`); an
 * untouched workspace — including saves from before the flag existed — always gets the CURRENT
 * default example, so shipping a new starter reaches returning visitors, not just fresh ones. */
function load(): Persisted {
  const fresh: Persisted = { files: [...DEFAULT_FILES], active: ENTRY, theme: "github-light" };
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return fresh;
    const saved = JSON.parse(raw) as Persisted;
    if (saved.dirty !== true) return { ...fresh, theme: saved.theme ?? fresh.theme };
    return { ...saved, dirty: true };
  } catch {
    return fresh;
  }
}

const initial = load();

/** The open files — one per editor tab. */
export const filesCell = data<PlaygroundFile[]>({ label: "files", initial: initial.files });
/** The active tab's file name. */
export const activeCell = data<string>({ label: "active", initial: initial.active });
/** The selected CodeMirror theme. */
export const themeCell = data<ThemeId>({ label: "theme", initial: initial.theme });
/** The latest build/runtime status shown in the bottom bar. */
export const statusCell = data<Status>({
  label: "status",
  initial: { kind: "info", text: "starting…" },
});
/** Which top-level view is showing: the editor or the benchmark. */
export const viewCell = data<View>({ label: "view", initial: "editor" });

export function createPlaygroundScope(): Scope.Handle {
  return createScope();
}

/** True once the user has changed a file (content, add, close, rename); reset clears it. */
export const dirtyCell = data<boolean>({ label: "dirty", initial: initial.dirty === true });

export function persist(
  files: PlaygroundFile[],
  active: string,
  theme: ThemeId,
  dirty: boolean,
): void {
  localStorage.setItem(STORAGE, JSON.stringify({ files, active, theme, dirty }));
}
