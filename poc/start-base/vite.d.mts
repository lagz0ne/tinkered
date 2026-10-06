import type { PluginOption } from "vite-plus";
/** The glue: one call in the app's vite.config.ts joins the app to the base (ADR 0106). */
export declare function tinker(options?: { root?: string }): PluginOption[];
