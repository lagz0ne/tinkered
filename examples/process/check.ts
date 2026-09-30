import { operation } from "@tinker/core";
import { z } from "zod";

export const check = operation({
  label: "check",
  input: z.string().min(1),
  run: (_deps, ctx) => `checked ${ctx.input}`,
});
