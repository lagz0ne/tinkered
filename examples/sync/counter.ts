import { data } from "@tinker/core";
import { source } from "@tinker/sync";

/** The row gives the cell its wire key; both demos reuse these declarations. */
export const counter = data({ label: "counter", initial: 0 });
export const src = source({ cells: [[counter, "counter"]] });
