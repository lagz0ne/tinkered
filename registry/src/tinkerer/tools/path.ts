import { relative, resolve, sep } from "node:path";
import { raise } from "../errors.ts";

/** Resolve `path` against `base` and refuse a result outside it (`PathOutsideCwd`). The one
 * guard every shipped tool takes before it touches the disk. */
export function resolveUnder(base: string, path: string, label: string): string {
  const target = resolve(base, path);
  const rel = relative(base, target);
  if (rel === ".." || rel.startsWith(`..${sep}`)) raise("PathOutsideCwd", { label, path });
  return target;
}
