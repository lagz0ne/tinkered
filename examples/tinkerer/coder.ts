import { namespace } from "@tinker/core";
import { tinkerer } from "@tinker/tinkerer";

/** Both entries reuse this graph; namespaces keep each conversation's data apart. */
export const coder = tinkerer({ label: "coder" });
export const a = namespace({ tags: coder.config({ system: "You are coder A." }) });
export const b = namespace({ tags: coder.config({ system: "You are coder B." }) });
