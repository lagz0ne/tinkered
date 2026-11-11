import { lazy } from "react";

export { roomName, sea } from "./contract";
/** The capsule that makes an ocean shared; see `tide.ts`. */
export { tide } from "./tide";

/** The page shows the sea in two frames, so it comes as its own chunk on first visit. */
export const LivePage = lazy(() => import("./page").then((m) => ({ default: m.LivePage })));
