import { readFile, writeFile } from "node:fs/promises";
import { operation } from "@tinker/core";
import type { Operation } from "@tinker/core";
import { z } from "zod";
import { raise } from "../errors.ts";
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
  run: async (deps, ctx) => editOnce(deps.cwd, ctx.input),
});

async function editOnce(base: string, input: EditInput): Promise<string> {
  const target = resolveUnder(base, input.path, "edit");
  const text = await readFile(target, "utf8");
  const count = countMatches(text, input.oldText);
  if (count !== 1) raise("EditMiss", { label: "edit", path: input.path, count });
  await writeFile(
    target,
    text.replace(input.oldText, () => input.newText),
    "utf8",
  );
  return `Edited ${input.path}`;
}

function countMatches(text: string, needle: string): number {
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length))
    count += 1;
  return count;
}
