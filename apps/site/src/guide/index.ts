import { capsule } from "@tinkered/core";

import { guideApi } from "./contract";

/**
 * The guide's capsule.
 * - `api`: the page list and one page, as calls (rpc).
 */
export const guide = capsule({ label: "guide", exports: { api: guideApi } });
