import { Link } from "@tanstack/react-router";

import type { Entry } from "./contract";

// The guide's pages. No state: each route loads its page by rpc, and these only draw it.

type Found = { slug: string; title: string; html: string; prev: Entry | null; next: Entry | null };

/** `/`: what Tinker is, and every page of the guide. */
export function GuideHome({ pages }: { pages: readonly Entry[] }) {
  return (
    <main className="home">
      <h1>Tinker</h1>
      <p className="lede">
        A TypeScript library for apps. Operations, data and resources in one graph; capsules as
        doors; rpc and remote data between a server scope and a client scope.
      </p>
      <ol className="toc">
        {pages.map((page) => (
          <li key={page.slug}>
            <Link to="/guide/$slug" params={{ slug: page.slug }}>
              {page.title}
            </Link>
            <p>{page.summary}</p>
          </li>
        ))}
      </ol>
      <p className="agents">
        For agents: <a href="/llms.txt">/llms.txt</a> and{" "}
        <a href="/llms-full.txt">/llms-full.txt</a>.
      </p>
    </main>
  );
}

/** `/guide/$slug`: one page, its markdown link, and the pages on each side. */
export function GuidePage({ page }: { page: Found }) {
  return (
    <main className="page">
      {/* The pages are the site's own text: Bun's markdown, from files in this repo. */}
      <article dangerouslySetInnerHTML={{ __html: page.html }} />
      <nav className="near" aria-label="Pages">
        {page.prev && (
          <Link to="/guide/$slug" params={{ slug: page.prev.slug }}>
            ← {page.prev.title}
          </Link>
        )}
        <a href={`/llms/${page.slug}.md`}>Markdown</a>
        {page.next && (
          <Link to="/guide/$slug" params={{ slug: page.next.slug }}>
            {page.next.title} →
          </Link>
        )}
      </nav>
    </main>
  );
}
