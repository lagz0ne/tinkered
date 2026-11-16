import { lazy } from "react";

/** The page shows the sea in two frames, so it comes as its own chunk on first visit. */
export const LivePage = lazy(() => import("./page").then((m) => ({ default: m.LivePage })));
