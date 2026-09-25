import { readFile, writeFile } from "node:fs/promises";
import { operation } from "@tinker/core";
import type { Operation } from "@tinker/core";
import { z } from "zod";
import type { Errors } from "../errors.ts";
import { cwd } from "./read.ts";
import { resolveUnder } from "./path.ts";

export const editDescription =
  "Replace one exact occurrence of oldText by newText in a file under cwd";

export const editInput = {
  path: z.string(),
  oldText: z.string().min(1),
  newText: z.string(),
};

export type EditInput = {
  readonly path: string;
  readonly oldText: string;
  readonly newText: string;
};

const editSchema = z.object(editInput);

/** The shipped `edit` tool: `{ path, oldText, newText }` → the one exact match replaced; zero
 * or several matches refuse with `EditMiss { path, count }` so the model narrows `oldText`. */
export const edit: Operation.Handle<Promise<string>, EditInput> = operation({
  label: "edit",
  input: (raw: unknown): EditInput => editSchema.parse(raw),
  depends: { cwd: cwd.required },
  run: async ({ cwd }, ctx) => {
    const target = resolveUnder(cwd, ctx.input.path, "edit");
    const text = await readFile(target, "utf8");
    const count = countMatches(text, ctx.input.oldText);
    if (count !== 1)
      ctx.raise("EditMiss", {
        label: "edit",
        path: ctx.input.path,
        count,
      } satisfies Errors.Payload<"EditMiss">);
    await writeFile(
      target,
      text.replace(ctx.input.oldText, () => ctx.input.newText),
      "utf8",
    );
    return `Edited ${ctx.input.path}`;
  },
});

function countMatches(text: string, needle: string): number {
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length))
    count += 1;
  return count;
}
