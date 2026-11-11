import { rpc } from "@tinker/core";
import { z } from "zod";

// The guide's contract: both sides import it. The server holds the pages; a page asks for the
// list and for one page. The same pages go to agents as markdown (`/llms.txt`, `/llms/*.md`).

const entry = z.object({ slug: z.string(), title: z.string(), summary: z.string() });

export type Entry = z.infer<typeof entry>;

export const guideApi = rpc({
  "guide.list": { input: z.null(), output: z.array(entry) },
  "guide.page": {
    input: z.object({ slug: z.string().regex(/^[a-z][a-z-]{0,40}$/) }),
    output: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("found"),
        slug: z.string(),
        title: z.string(),
        html: z.string(),
        prev: entry.nullable(),
        next: entry.nullable(),
      }),
      z.object({ kind: z.literal("gone") }),
    ]),
  },
});
