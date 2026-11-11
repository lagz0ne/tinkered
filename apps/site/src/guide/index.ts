import { capsule } from "@tinker/core";

import { guideApi } from "./contract";

export type { Entry } from "./contract";
export { GuideHome, GuidePage } from "./guide";

/**
 * The guide's one door: others and the cmds import `@/guide` only.
 * - `api`: the page list and one page, as calls (rpc).
 */
export const guide = capsule({ label: "guide", exports: { api: guideApi } });
