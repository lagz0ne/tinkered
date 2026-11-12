import { data, tag } from "@tinkered/core";
import { z } from "zod";

import app from "./starter/App.tsx?raw";
import draw from "./starter/draw.ts?raw";
import engine from "./starter/engine.ts?raw";
import loop from "./starter/loop.ts?raw";
import main from "./starter/main.tsx?raw";
import ocean from "./starter/ocean.ts?raw";
import scene from "./starter/Scene.tsx?raw";
import state from "./starter/state.ts?raw";
import style from "./starter/style.ts?raw";

// The play page's state. Only the play ops and services write it; the page draws it.

/** One editor tab: one file of the project the preview runs. */
export type PlayFile = { name: string; content: string };

/** The bundler's entry. Other files are reached through relative imports. */
export const entry = "main.tsx";

/** The starter project: the tile ocean in starter/, real modules checked by the site's tsc. */
export const starter: readonly PlayFile[] = [
  { name: "main.tsx", content: main },
  { name: "ocean.ts", content: ocean },
  { name: "state.ts", content: state },
  { name: "engine.ts", content: engine },
  { name: "draw.ts", content: draw },
  { name: "loop.ts", content: loop },
  { name: "App.tsx", content: app },
  { name: "Scene.tsx", content: scene },
  { name: "style.ts", content: style },
];

/** What the bottom line says: compiling, running, ready, or the error. `ms` is the last compile. */
export type Status = { kind: "ok" | "error" | "info"; text: string; ms?: number };

/** A session as it is kept. `dirty` marks a changed project; a clean one yields to a new starter. */
export const saved = z.object({
  files: z.array(z.object({ name: z.string(), content: z.string() })).min(1),
  active: z.string(),
  dirty: z.boolean(),
  theme: z.enum(["github-light", "github-dark", "one-dark"]).catch("github-light"),
});

export type Saved = z.infer<typeof saved>;

/** The open files, one per tab. */
export const files = data<PlayFile[]>({ label: "play.files", initial: [...starter] });
/** A spot in a file: the tab or library source, and the character offset in it. */
export type Place = { file: string; offset: number };

/**
 * Where the editor stands: `place` is on screen; `back` holds where it came from, newest last;
 * `forward` holds what a step back undid. A jump adds to `back` and clears `forward`.
 */
export type Nav = { place: Place; back: Place[]; forward: Place[] };

export const nav = data<Nav>({
  label: "play.nav",
  initial: { place: { file: entry, offset: 0 }, back: [], forward: [] },
});

/** True once the visitor changed the project; reset clears it. */
export const dirty = data<boolean>({ label: "play.dirty", initial: false });
/** The editor's colours. A clean session keeps it too. */
export type Theme = Saved["theme"];
export const theme = data<Theme>({ label: "play.theme", initial: "github-light" });
/** Play shows the preview alone; code shows the editor beside it. */
export const view = data<"play" | "code">({ label: "play.view", initial: "play" });

export const status = data<Status>({
  label: "play.status",
  initial: { kind: "info", text: "starting…" },
});

/** The last bundle that compiled: what the preview runs. */
export const bundle = data<string | null>({ label: "play.bundle", initial: null });

/** Where a session is kept: the Web Storage shape. The page's cmd passes `localStorage`. */
export const storage = tag<Pick<Storage, "getItem" | "setItem">>({ label: "play.storage" });
/** Ms of quiet after an edit before the bundler compiles. */
export const debounce = tag<number>({ label: "play.debounce" });
/** Where the browser loads the compiler from; in Bun (tests) esbuild finds its own. */
export const wasm = tag<string | null>({ label: "play.wasm" });
/** The tab showing its rename box, if any. */
export const renaming = data<string | null>({ label: "play.renaming", initial: null });
/** Where the preview's messages arrive: the page's `window`; a test passes an `EventTarget`. */
export const inbox = tag<EventTarget>({ label: "play.inbox" });
