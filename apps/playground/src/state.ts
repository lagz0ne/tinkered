import { data, tag } from "@tinker/core";
import { DEFAULT_FILES, ENTRY, type PlaygroundFile } from "@/lib/files.ts";
import { THEMES, type ThemeId } from "@/lib/themes.ts";

/** The build/runtime status shown in the bottom bar; `ms` is the last compile's duration. */
export type Status = { kind: "ok" | "error" | "info"; text: string; ms?: number };
export type View = "editor" | "bench";

/** A session as it is stored. `dirty` marks files the user changed; without it a stored session
 * yields to the current default example, so a new starter reaches returning visitors. */
export type Saved = { files: PlaygroundFile[]; active: string; theme: ThemeId; dirty: boolean };

export declare namespace Storage {
  /** Where sessions are kept. The browser's localStorage by default; a Map in a test. */
  export type Handle = { load(): Saved | undefined; save(saved: Saved): void };
}

const isFile = (value: unknown): value is PlaygroundFile =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as PlaygroundFile).name === "string" &&
  typeof (value as PlaygroundFile).content === "string";

const isTheme = (value: unknown): value is ThemeId => THEMES.some((t) => t.id === value);

/** Admit one stored session: the shape check at the door, once. Anything else is "no session". */
function readSaved(raw: unknown): Saved | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { files, active, theme, dirty } = raw as Partial<Saved>;
  if (!Array.isArray(files) || !files.every(isFile) || files.length === 0) return undefined;
  if (typeof active !== "string" || !isTheme(theme)) return undefined;
  return { files, active, theme, dirty: dirty === true };
}

const KEY = "tinkered-playground:v2";

const browserStorage: Storage.Handle = {
  load: () => {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return undefined;
    try {
      return readSaved(JSON.parse(raw));
    } catch {
      return undefined;
    }
  },
  save: (saved) => localStorage.setItem(KEY, JSON.stringify(saved)),
};

/** Ambient config: what a scope binds, what a test rebinds. */
export const storage = tag<Storage.Handle>({ label: "storage", default: browserStorage });
export const entry = tag<string>({ label: "entry", default: ENTRY });
export const debounce = tag<number>({ label: "debounce", default: 250 });

/** The open files — one per editor tab. */
export const filesCell = data<PlaygroundFile[]>({ label: "files", initial: [...DEFAULT_FILES] });
/** The active tab's file name. */
export const activeCell = data<string>({ label: "active", initial: ENTRY });
/** The selected CodeMirror theme. */
export const themeCell = data<ThemeId>({ label: "theme", initial: "github-light" });
/** Which top-level view is showing: the editor or the benchmark. */
export const viewCell = data<View>({ label: "view", initial: "editor" });
/** True once the user has changed a file (content, add, close, rename); reset clears it. */
export const dirtyCell = data<boolean>({ label: "dirty", initial: false });
/** The latest build/runtime status. */
export const statusCell = data<Status>({
  label: "status",
  initial: { kind: "info", text: "starting…" },
});
/** The last successful bundle: what the preview runs. Undefined until the first compile lands. */
export const bundleCell = data<string | undefined>({ label: "bundle", initial: undefined });
