import { operation, resource } from "@tinker/core";
import { z } from "zod";

import { guideApi } from "./contract";
import type { Entry } from "./contract";
import { sources } from "./pages.server";

// The server's work for the guide. The book is read once per scope: each page's title is its
// `# ` line, its summary its first paragraph, its HTML from Bun's markdown. People read the
// HTML over rpc; agents read the markdown over plain GET (llmstxt.org).

type Page = Entry & { text: string; html: string };

export const book = resource({
  label: "guide.book",
  factory: (): readonly Page[] =>
    sources.map(({ slug, text }) => {
      const [head = "", ...rest] = text.split("\n\n");
      return {
        slug,
        title: head.replace(/^# /, "").trim(),
        summary: (rest[0] ?? "").replaceAll("\n", " ").replaceAll("`", "").trim(),
        text,
        html: Bun.markdown.html(text),
      };
    }),
});

export const listPages = operation({
  label: "guide.list.do",
  input: guideApi["guide.list"].input,
  depends: { book },
  run: ({ book }) => book.map(({ slug, title, summary }) => ({ slug, title, summary })),
});

export const readPage = operation({
  label: "guide.page.do",
  input: guideApi["guide.page"].input,
  depends: { book },
  run: ({ book }, { input }) => {
    const at = book.findIndex((page) => page.slug === input.slug);
    if (at < 0) return { kind: "gone" as const };
    const [prev, next] = [book[at - 1], book[at + 1]].map((page) =>
      page ? { slug: page.slug, title: page.title, summary: page.summary } : null,
    );
    const { slug, title, html } = book[at]!;
    return { kind: "found" as const, slug, title, html, prev: prev ?? null, next: next ?? null };
  },
});

/** `GET /llms.txt`: the index an agent reads first (llmstxt.org). */
export const llmsIndex = operation({
  label: "guide.llms",
  depends: { book },
  run: ({ book }) =>
    new Response(
      [
        "# Tinker",
        "",
        "> A TypeScript library for apps: operations, data, resources and capsules,",
        "> with rpc and remote data between a server scope and a client scope.",
        "",
        "## Guide",
        "",
        ...book.map((page) => `- [${page.title}](/llms/${page.slug}.md): ${page.summary}`),
        "",
        "## Optional",
        "",
        "- [Every page](/llms-full.txt): the whole guide in one file",
        "",
      ].join("\n"),
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    ),
});

/** `GET /llms-full.txt`: every page, in reading order. */
export const llmsFull = operation({
  label: "guide.llms.full",
  depends: { book },
  run: ({ book }) =>
    new Response(book.map((page) => page.text).join("\n\n"), {
      headers: { "content-type": "text/plain; charset=utf-8" },
    }),
});

/** `GET /llms/{slug}.md`: one page as written. */
export const pageText = operation({
  label: "guide.markdown",
  input: z.object({ slug: z.string() }),
  depends: { book },
  run: ({ book }, { input }) => {
    const page = book.find((p) => p.slug === input.slug);
    if (!page) return new Response("Not found\n", { status: 404 });
    return new Response(page.text, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  },
});

/** The server's side of `guide.api`, by address: `guide.api({ implement: guideOps })`. */
export const guideOps = { "guide.list": listPages, "guide.page": readPage } as const;

/** The guide's plain GET rows, for the cmd's route table. */
export const guideRoutes = {
  "GET /llms.txt": llmsIndex,
  "GET /llms-full.txt": llmsFull,
  "GET /llms/{slug}.md": pageText,
} as const;

/** The Bun paths those rows need: `serve({ paths })`. */
export const guidePaths = ["/llms.txt", "/llms-full.txt", "/llms/*"];
