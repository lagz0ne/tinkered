import { capsule } from "@tinker/core";
import { lazy } from "react";

import { lastSaved } from "./model";

export const SessionsPage = lazy(() => import("./page").then((m) => ({ default: m.SessionsPage })));

/**
 * The sessions study's one door: others and the cmds import `@/sessions` only.
 * - `lastSaved`: the last title saved from any project (read only).
 */
export const sessions = capsule({ label: "sessions", exports: { lastSaved } });
