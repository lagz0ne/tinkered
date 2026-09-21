import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { operation } from "@tinker/core";
import type { Operation } from "@tinker/core";
import { z } from "zod";
import { cwd } from "./read.ts";
import { resolveUnder } from "./path.ts";

export const writeDescription = "Write a whole file under cwd, creating parent folders";

export const writeInput = {
  path: z.string(),
  content: z.string(),
};

export type WriteInput = {
  readonly path: string;
  readonly content: string;
};

const writeSchema = z.object(writeInput);

/** The shipped `write` tool: `{ path, content }` → the file written whole under cwd, parents
 * created; answers `Wrote <bytes> bytes to <path>`. */
export const write: Operation.Handle<Promise<string>, WriteInput> = operation({
  label: "write",
  input: (raw: unknown): WriteInput => writeSchema.parse(raw),
  depends: { cwd: cwd.required },
  run: async (deps, ctx) => writeWhole(deps.cwd, ctx.input),
});

async function writeWhole(base: string, input: WriteInput): Promise<string> {
  const target = resolveUnder(base, input.path, "write");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, input.content, "utf8");
  return `Wrote ${Buffer.byteLength(input.content, "utf8")} bytes to ${input.path}`;
}
