import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { operation, tag } from "@tinker/core";
import type { Operation, Tag } from "@tinker/core";
import { z } from "zod";
import { raise } from "../errors.ts";

export const cwd: Tag.Handle<string> = tag({ label: "tinkerer.cwd" });

export const readDescription = "Read a file under cwd, optionally a window of lines";

export const readInput = {
  path: z.string(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().positive().optional(),
};

export type ReadInput = {
  readonly path: string;
  readonly offset?: number;
  readonly limit?: number;
};

const readSchema = z.object(readInput);

export const read: Operation.Handle<Promise<string>, ReadInput> = operation({
  label: "read",
  input: readRawInput,
  depends: { cwd: cwd.required },
  run: async (deps, ctx) => readWindow(deps.cwd, ctx.input),
});

function readRawInput(raw: unknown): ReadInput {
  return readSchema.parse(raw);
}

async function readWindow(base: string, input: ReadInput): Promise<string> {
  const target = resolve(base, input.path);
  if (isOutside(base, target)) raise("PathOutsideCwd", { label: "read", path: input.path });
  const text = await readFile(target, "utf8");
  return windowLines(text, input.offset ?? 0, input.limit);
}

function isOutside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === ".." || rel.startsWith(`..${sep}`);
}

function windowLines(text: string, offset: number, limit: number | undefined): string {
  const lines = text.split("\n");
  const end = limit === undefined ? lines.length : offset + limit;
  return lines.slice(offset, end).join("\n");
}
