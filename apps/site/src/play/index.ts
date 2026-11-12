import { capsule } from "@tinker/core";
import { lazy } from "react";

import { debounce, files, inbox, status, storage, wasm } from "./state";

export type { PlayFile, Status } from "./state";
/** The starter's ocean, as the playground runs it: the capsule, with its page as `View`. `/live` runs it too. */
export { ocean } from "./starter/ocean";

/** The page carries the editor and the compiler, so it comes as its own chunk on first visit. */
export const PlayPage = lazy(() => import("./page").then((m) => ({ default: m.PlayPage })));

/**
 * The playground's one door: others and the cmds import `@/play` only.
 * - config `storage`: where a session is kept; the page's cmd passes `localStorage`.
 * - config `debounce`: ms of quiet after an edit before a compile.
 * - config `wasm`: the URL of esbuild.wasm, or null where esbuild needs none (Bun).
 * - config `inbox`: where the preview frame's messages arrive; the page's cmd passes `window`.
 * - `files`: the open project; `status`: what the last compile or run said (read only).
 */
export const play = capsule({
  label: "play",
  config: {
    storage: storage.required,
    debounce: debounce.required,
    wasm: wasm.required,
    inbox: inbox.required,
  },
  exports: { files, status },
});
