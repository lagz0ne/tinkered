import { operation } from "@tinker/core";
import { expose, mcp } from "@tinker/mcp";
import { z } from "zod";

const searchShape = { q: z.string() };
const search = operation({
  label: "search",
  input: z.object(searchShape),
  run: (_deps, ctx) => [`hit:${ctx.input.q}`],
});

/** The same declared graph serves each entry; each root gets its own server. */
export const searchMcp = mcp({
  name: "coder",
  version: "1.0.0",
  tools: [expose(search, { description: "search the index", schema: searchShape })],
});
